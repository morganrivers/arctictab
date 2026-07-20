import {
  INTERESTS, CATEGORIES, POSTS, PLATFORMS,
  LEANINGS, AGES, GENDERS,
} from "./data.js";

/* -------------------------------------------------------------------------
 * tiny seeded RNG so a given profile+platform always yields the same feed
 * ---------------------------------------------------------------------- */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------
 * the model: score every post for a profile on a platform, take the top feed
 * ---------------------------------------------------------------------- */
function scoreFeed(profile, platform, size = 11) {
  const age = AGES.find(a => a.key === profile.age);
  const bucket = age.bucket;                 // young | mid | old
  const rand = mulberry32(hashString(profile.id + "|" + platform.key));

  const scored = POSTS.map((post, i) => {
    const cat = CATEGORIES[post.cat];
    let s = 1;

    // 1. interest match — the single biggest lever
    if (cat.interest && profile.interests.includes(cat.interest)) {
      s += 3.2;
    } else if (cat.interest) {
      // content outside your interests only leaks in via the platform's "discovery"
      s += platform.discovery * 0.9;
    } else {
      s += 0.8; // universal content (wholesome, conspiracy) always eligible
    }

    // 2. platform pushes some categories much harder than others
    const bias = platform.catBias[post.cat] ?? 1;
    s *= bias;

    // 3. demographics steer the feed (stronger on personalization-heavy platforms)
    const ageAff = cat.age[bucket] ?? 1;
    const genAff = cat.gender[profile.gender] ?? 1;
    s *= 1 + (ageAff - 1) * platform.ageFocus;
    s *= 1 + (genAff - 1) * platform.ageFocus;

    // 4. political alignment — the echo chamber
    if (cat.political) {
      const align = 2 - Math.abs(post.lean - profile.lean); // 2 = perfect match
      s *= 1 + Math.max(0, align) * 0.35 * platform.amplify;
      // outrage platforms ALSO feed you the other side's outrage — anger is watch time
      const opposed = Math.sign(post.lean) !== 0 && Math.sign(post.lean) !== Math.sign(profile.lean || post.lean);
      if (opposed && post.tone === "outrage") {
        s *= 1 + platform.rageOther * 0.6;
      }
    }

    // 5. engagement bait amplified per platform
    s *= 1 + post.bait * (platform.bait - 1) * 0.8;

    // 6. a little seeded noise so feeds feel alive, not ranked-by-formula
    s *= 0.8 + rand() * 0.5;

    return { post, cat, score: s, i };
  });

  scored.sort((a, b) => b.score - a.score);

  // de-dupe heavy repetition: cap 2 per category in the visible feed
  const out = [];
  const perCat = {};
  for (const item of scored) {
    perCat[item.post.cat] = (perCat[item.post.cat] || 0) + 1;
    if (perCat[item.post.cat] > 2) continue;
    out.push(item);
    if (out.length >= size) break;
  }
  return out;
}

/* -------------------------------------------------------------------------
 * metrics that describe how distorted the resulting world is
 * ---------------------------------------------------------------------- */
function metrics(feed, profile) {
  const n = feed.length || 1;
  const political = feed.filter(f => f.cat.political);
  const outrage = feed.filter(f => ["outrage", "fear"].includes(f.post.tone));
  const cats = new Set(feed.map(f => f.post.cat));

  // echo: of the political posts, share that lean the user's way (or center)
  let aligned = 0;
  for (const f of political) {
    const same = Math.sign(f.post.lean) === Math.sign(profile.lean) || f.post.lean === 0 || profile.lean === 0;
    if (same) aligned++;
  }
  const echo = political.length ? aligned / political.length : null;

  return {
    outrageRatio: outrage.length / n,
    politicalRatio: political.length / n,
    diversity: cats.size,
    echo,
    baitAvg: feed.reduce((a, f) => a + f.post.bait, 0) / n,
  };
}

/* -------------------------------------------------------------------------
 * "why am I seeing this?" — a plausible reason string per post
 * ---------------------------------------------------------------------- */
function whyShown(item, profile, platform) {
  const { cat, post } = item;
  const reasons = [];
  if (cat.interest && profile.interests.includes(cat.interest)) {
    reasons.push(`you told us you're into ${INTERESTS.find(x => x.key === cat.interest)?.label.toLowerCase()}`);
  }
  if (cat.political && post.lean !== 0) {
    const same = Math.sign(post.lean) === Math.sign(profile.lean);
    reasons.push(same ? "it agrees with people like you" : "it makes people like you argue");
  }
  if (post.bait > 0.7) reasons.push("it's driving huge engagement right now");
  const age = AGES.find(a => a.key === profile.age);
  if ((cat.age[age.bucket] ?? 1) > 1.2) reasons.push(`it performs well with ${age.label}`);
  const g = cat.gender[profile.gender] ?? 1;
  if (g > 1.25) reasons.push(`${GENDERS.find(x => x.key === profile.gender)?.label.toLowerCase()}s watch it to the end`);
  if (!reasons.length) reasons.push(`${platform.name} is showing you something outside your usual lane`);
  return reasons[0][0].toUpperCase() + reasons[0].slice(1) + ".";
}

/* -------------------------------------------------------------------------
 * default profiles + UI state
 * ---------------------------------------------------------------------- */
function newProfile(seed) {
  return {
    age: seed.age, gender: seed.gender, lean: seed.lean,
    interests: [...seed.interests],
    get id() { return `${this.age}|${this.gender}|${this.lean}|${[...this.interests].sort().join(",")}`; },
  };
}

const state = {
  compare: false,
  platform: "tiktok",
  A: newProfile({ age: "young", gender: "man", lean: 1, interests: ["gaming", "finance", "tech"] }),
  B: newProfile({ age: "older", gender: "woman", lean: -1, interests: ["news", "parenting", "spirituality"] }),
};

/* -------------------------------------------------------------------------
 * rendering
 * ---------------------------------------------------------------------- */
const $ = sel => document.querySelector(sel);

function buildProfileEditor(slot, profile) {
  const el = document.createElement("div");
  el.className = "editor";
  el.innerHTML = `
    <div class="editor-head"><span class="slot-tag slot-${slot}">Profile ${slot}</span></div>
    <label>Age</label>
    <div class="chips" data-field="age"></div>
    <label>Gender</label>
    <div class="chips" data-field="gender"></div>
    <label>Political leaning</label>
    <div class="chips lean" data-field="lean"></div>
    <label>Interests <span class="hint">(pick a few)</span></label>
    <div class="chips wrap" data-field="interests"></div>
  `;

  const mkChip = (label, active, onclick) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : "");
    b.textContent = label;
    b.onclick = onclick;
    return b;
  };

  AGES.forEach(a => el.querySelector('[data-field=age]').append(
    mkChip(a.label, profile.age === a.key, () => { profile.age = a.key; render(); })));
  GENDERS.forEach(g => el.querySelector('[data-field=gender]').append(
    mkChip(g.label, profile.gender === g.key, () => { profile.gender = g.key; render(); })));
  LEANINGS.forEach(l => el.querySelector('[data-field=lean]').append(
    mkChip(l.label, profile.lean === l.value, () => { profile.lean = l.value; render(); })));
  INTERESTS.forEach(it => el.querySelector('[data-field=interests]').append(
    mkChip(it.label, profile.interests.includes(it.key), () => {
      const idx = profile.interests.indexOf(it.key);
      if (idx >= 0) profile.interests.splice(idx, 1); else profile.interests.push(it.key);
      render();
    })));

  return el;
}

function meter(label, value, kind) {
  // value 0..1
  const pct = Math.round(value * 100);
  const el = document.createElement("div");
  el.className = "meter";
  el.innerHTML = `
    <div class="meter-top"><span>${label}</span><span class="meter-val">${pct}%</span></div>
    <div class="meter-track"><div class="meter-fill ${kind}" style="width:${pct}%"></div></div>`;
  return el;
}

function renderColumn(slot, profile, platform) {
  const feed = scoreFeed(profile, platform);
  const m = metrics(feed, profile);

  const col = document.createElement("div");
  col.className = "feed-col";

  // metrics dashboard
  const dash = document.createElement("div");
  dash.className = "dash";
  const echoLabel = m.echo === null ? "—" : `${Math.round(m.echo * 100)}%`;
  dash.innerHTML = `<div class="dash-head">
      <span class="slot-tag slot-${slot}">Profile ${slot}</span>
      <span class="dash-sub">${describeProfile(profile)}</span>
    </div>`;
  const meters = document.createElement("div");
  meters.className = "meters";
  meters.append(
    meter("Outrage & fear", m.outrageRatio, "bad"),
    meter("Political content", m.politicalRatio, "warn"),
    meter("Engagement-bait", m.baitAvg, "warn"),
  );
  const echoEl = document.createElement("div");
  echoEl.className = "echo";
  echoEl.innerHTML = `<span class="echo-num">${echoLabel}</span>
    <span class="echo-label">of political posts already agree with this person<br>
    <small>${m.diversity} distinct topics in the feed</small></span>`;
  meters.append(echoEl);
  dash.append(meters);
  col.append(dash);

  // feed
  const list = document.createElement("div");
  list.className = "feed-list";
  feed.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "post";
    const toneClass = ["outrage", "fear"].includes(item.post.tone) ? "tone-hot"
      : ["aspiration", "identity"].includes(item.post.tone) ? "tone-warm" : "tone-calm";
    const likes = 1 + Math.floor(item.post.bait * 900 + (item.score * 40));
    card.innerHTML = `
      <div class="post-head">
        <div class="avatar" style="--c:${stringColor(item.post.handle)}">${item.post.handle[1].toUpperCase()}</div>
        <div class="post-meta">
          <span class="handle">${item.post.handle}</span>
          <span class="cat ${toneClass}">${CATEGORIES[item.post.cat].label}</span>
        </div>
        <span class="rank">#${idx + 1}</span>
      </div>
      <p class="post-body">${escapeHtml(item.post.text)}</p>
      <div class="post-foot">
        <span class="engagement">❤ ${formatK(likes)} · 💬 ${formatK(Math.floor(likes / 6))}</span>
      </div>
      <div class="why"><span class="why-tag">Why you're seeing this</span> ${escapeHtml(whyShown(item, profile, platform))}</div>
    `;
    list.append(card);
  });
  col.append(list);
  return col;
}

function describeProfile(p) {
  const age = AGES.find(a => a.key === p.age).label;
  const g = GENDERS.find(x => x.key === p.gender).label.toLowerCase();
  const lean = LEANINGS.find(l => l.value === p.lean).label.toLowerCase();
  return `${age} · ${g} · ${lean}`;
}

function render() {
  // platform pills
  const pills = $("#platforms");
  pills.innerHTML = "";
  PLATFORMS.forEach(p => {
    const b = document.createElement("button");
    b.className = "pill" + (state.platform === p.key ? " active" : "");
    b.style.setProperty("--pc", p.color);
    b.innerHTML = `<span class="pill-emoji">${p.emoji}</span>${p.name}`;
    b.onclick = () => { state.platform = p.key; render(); };
    pills.append(b);
  });

  const platform = PLATFORMS.find(p => p.key === state.platform);
  $("#platform-tagline").textContent = platform.tagline;

  // editors
  const eds = $("#editors");
  eds.innerHTML = "";
  eds.append(buildProfileEditor("A", state.A));
  if (state.compare) eds.append(buildProfileEditor("B", state.B));
  eds.classList.toggle("two", state.compare);

  // feeds
  const feeds = $("#feeds");
  feeds.innerHTML = "";
  feeds.classList.toggle("two", state.compare);
  feeds.append(renderColumn("A", state.A, platform));
  if (state.compare) feeds.append(renderColumn("B", state.B, platform));

  $("#compare-toggle").textContent = state.compare ? "← Single profile" : "Compare two worlds →";
}

/* helpers */
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function formatK(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n); }
function stringColor(s) { const h = hashString(s) % 360; return `hsl(${h} 55% 45%)`; }

/* wire up */
$("#compare-toggle").onclick = () => { state.compare = !state.compare; render(); };
document.querySelectorAll("[data-preset]").forEach(btn => {
  btn.onclick = () => applyPreset(btn.dataset.preset);
});

function applyPreset(name) {
  const presets = {
    contrast: [
      { age: "young", gender: "man", lean: 2, interests: ["gaming", "finance", "politics"] },
      { age: "mid", gender: "woman", lean: -2, interests: ["parenting", "news", "spirituality"] },
    ],
    teens: [
      { age: "teen", gender: "woman", lean: -1, interests: ["beauty", "entertainment", "spirituality"] },
      { age: "teen", gender: "man", lean: 1, interests: ["gaming", "fitness", "finance"] },
    ],
    seniors: [
      { age: "senior", gender: "man", lean: 2, interests: ["news", "politics", "sports"] },
      { age: "senior", gender: "woman", lean: -1, interests: ["news", "food", "parenting"] },
    ],
  };
  const [a, b] = presets[name];
  state.A = newProfile(a); state.B = newProfile(b);
  state.compare = true;
  render();
}

render();
