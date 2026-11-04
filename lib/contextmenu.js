const STYLE_ID = "arctictab-ctxmenu-style";
const CSS = `
.ctxmenu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  padding: 4px 0;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  font: 13px system-ui, sans-serif;
}
.ctxmenu-item {
  display: block;
  width: 100%;
  padding: 5px 12px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: default;
  white-space: nowrap;
}
.ctxmenu-item:hover:not([disabled]),
.ctxmenu-item.sel:not([disabled]) {
  background: var(--accent);
  color: var(--accent-fg, #fff);
}
.ctxmenu-item[disabled] { opacity: 0.4; }
.ctxmenu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}
`;

let openMenu = null;

function ensureStyles(doc) {
  console.assert(doc && doc.head, "context menu needs a document");
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

export function closeContextMenu() {
  if (!openMenu) return;
  openMenu.teardown();
  openMenu = null;
}

function place(el, x, y) {
  const { innerWidth: w, innerHeight: h } = window;
  const r = el.getBoundingClientRect();
  console.assert(r.width > 0 && r.height > 0, "menu must be measurable before placement");
  el.style.left = `${Math.max(2, Math.min(x, w - r.width - 2))}px`;
  el.style.top = `${Math.max(2, Math.min(y, h - r.height - 2))}px`;
}

export function openContextMenu(items, { x, y, onSelect, onClose = () => {} }) {
  console.assert(Array.isArray(items) && items.length > 0, "a context menu needs items");
  console.assert(typeof onSelect === "function", "a context menu needs an onSelect handler");
  closeContextMenu();
  const doc = document;
  ensureStyles(doc);
  const menu = doc.createElement("div");
  menu.className = "ctxmenu";
  menu.setAttribute("role", "menu");
  const buttons = [];
  for (const item of items) {
    if (item.separator) {
      const sep = doc.createElement("div");
      sep.className = "ctxmenu-sep";
      menu.appendChild(sep);
      continue;
    }
    const btn = doc.createElement("button");
    btn.className = "ctxmenu-item";
    btn.type = "button";
    btn.textContent = item.label;
    btn.setAttribute("role", "menuitem");
    if (item.disabled) btn.disabled = true;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeContextMenu();
      onSelect(item.id);
    });
    menu.appendChild(btn);
    buttons.push(btn);
  }
  console.assert(buttons.length > 0, "a context menu needs at least one selectable item");
  doc.body.appendChild(menu);
  place(menu, x, y);

  let sel = -1;
  const enabled = () => buttons.filter((b) => !b.disabled);
  const step = (delta) => {
    const list = enabled();
    if (!list.length) return;
    sel = (sel + delta + list.length) % list.length;
    list.forEach((b, i) => b.classList.toggle("sel", i === sel));
    list[sel].focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeContextMenu(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); step(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) closeContextMenu(); };
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("mousedown", onOutside, true);
  doc.addEventListener("contextmenu", onOutside, true);
  window.addEventListener("blur", closeContextMenu);
  window.addEventListener("resize", closeContextMenu);
  doc.addEventListener("scroll", closeContextMenu, true);

  openMenu = {
    teardown() {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("mousedown", onOutside, true);
      doc.removeEventListener("contextmenu", onOutside, true);
      window.removeEventListener("blur", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      doc.removeEventListener("scroll", closeContextMenu, true);
      menu.remove();
      onClose();
    },
  };
  return menu;
}
