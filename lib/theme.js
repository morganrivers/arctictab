const PREFERS_DARK = "(prefers-color-scheme: dark)";

function parseColor(value) {
  if (!value) return null;
  const s = String(value).trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}

function luminance(rgb) {
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function isDark(color) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  return luminance(rgb) < 0.5;
}

function themeIsDark(theme) {
  const colors = theme && theme.colors;
  if (!colors) return null;
  const candidates = [
    colors.toolbar,
    colors.frame,
    colors.ntp_background,
    colors.popup,
  ];
  for (const c of candidates) {
    const d = isDark(c);
    if (d !== null) return d;
  }
  return null;
}

async function detectDark() {
  const mm = globalThis.matchMedia ? globalThis.matchMedia(PREFERS_DARK) : null;
  const api = globalThis.browser || globalThis.chrome;
  if (api && api.theme && typeof api.theme.getCurrent === "function") {
    try {
      const theme = await api.theme.getCurrent();
      const d = themeIsDark(theme);
      if (d !== null) return d;
    } catch {}
  }
  return !!(mm && mm.matches);
}

async function apply() {
  const dark = await detectDark();
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function initTheme() {
  apply();
  const api = globalThis.browser || globalThis.chrome;
  if (api && api.theme && api.theme.onUpdated && api.theme.onUpdated.addListener) {
    api.theme.onUpdated.addListener(apply);
  }
  if (globalThis.matchMedia) {
    const mm = globalThis.matchMedia(PREFERS_DARK);
    if (mm.addEventListener) mm.addEventListener("change", apply);
    else if (mm.addListener) mm.addListener(apply);
  }
}
