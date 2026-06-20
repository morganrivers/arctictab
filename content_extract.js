(() => {
  const og = document.querySelector('meta[property="og:description"]')?.content || "";
  const desc = document.querySelector('meta[name="description"]')?.content || "";
  const h1 = document.querySelector("h1")?.innerText?.trim() || "";
  const p = document.querySelector("article p, main p, p")?.innerText?.trim() || "";
  const text = [og, desc, h1, p].filter(Boolean).join(" ").slice(0, 800);
  return { text };
})();
