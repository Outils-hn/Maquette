// Detecteur de details visuels (mots orphelins, textes tronques, libelles sur 2 lignes, elements hors ecran ou qui se chevauchent).
// Ajoute des lignes « NOTE detail [ecran] ... » : informatives, avec quelques faux positifs connus (champs caches derriere une fenetre, etc.).
export async function detailsVisuels(p, nom, lignes) {
  const r = await p.evaluate(() => {
    const vu = (e) => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0; };
    const dec = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
    const res = [];
    // 1. Mot orphelin : derniere ligne d'un texte de plusieurs lignes reduite a un seul mot
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode()); ) {
      const e = n.parentElement; if (!e || !vu(e) || /SCRIPT|STYLE/.test(e.tagName)) continue;
      const t = n.textContent; if (t.trim().split(/\s+/).length < 4) continue;
      const mots = [...t.matchAll(/\S+/g)]; const lignes = new Map();
      for (const m of mots) { const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); const rc = rg.getClientRects()[0]; if (!rc) continue; const k = Math.round(rc.top / 4); lignes.set(k, [...(lignes.get(k) ?? []), m[0]]); }
      const ks = [...lignes.keys()].sort((a, b) => a - b);
      if (ks.length >= 2 && lignes.get(ks[ks.length - 1]).length === 1) res.push(`orphelin « ${lignes.get(ks[ks.length - 1])[0]} » dans ${dec(e)} : ${t.trim().slice(0, 60)}`);
    }
    // 2. Texte tronque (points de suspension)
    for (const e of document.querySelectorAll("body *")) { if (!vu(e) || e.children.length) continue; const s = getComputedStyle(e); if (s.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1) res.push(`tronque ${dec(e)} : ${e.textContent.trim().slice(0, 50)}`); }
    // 3. Boutons / pastilles dont le libelle passe sur 2 lignes
    for (const e of document.querySelectorAll("button, a.btn, [role=tab], .badge")) { if (!vu(e)) continue; const lh = parseFloat(getComputedStyle(e).lineHeight) || 18; if (e.getBoundingClientRect().height > lh * 2.4 && e.textContent.trim().split(/\s+/).length > 1 && e.textContent.trim().length < 40) res.push(`libelle sur 2 lignes ${dec(e)} : ${e.textContent.trim()}`); }
    // 4. Debordement horizontal de la page, elements coupes a droite
    if (document.documentElement.scrollWidth > innerWidth + 1) res.push(`page plus large que l'ecran (${document.documentElement.scrollWidth} > ${innerWidth})`);
    for (const e of document.querySelectorAll("button, a, input, select, h1, h2, h3")) { if (!vu(e)) continue; const b = e.getBoundingClientRect(); if (b.right > innerWidth + 1 || b.left < -1) res.push(`hors ecran ${dec(e)} : ${(e.textContent || e.value || "").trim().slice(0, 40)}`); }
    // 5. Chevauchement de deux boutons / champs visibles
    const it = [...document.querySelectorAll("button, a[href], input, select")].filter(vu).map((e) => [e, e.getBoundingClientRect()]);
    for (let i = 0; i < it.length; i++) for (let j = i + 1; j < it.length; j++) { const [a, A] = it[i], [c, C] = it[j]; if (a.contains(c) || c.contains(a)) continue; const w = Math.min(A.right, C.right) - Math.max(A.left, C.left), h = Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top); if (w > 4 && h > 4) res.push(`chevauchement ${dec(a)} « ${(a.textContent || "").trim().slice(0, 25)} » / ${dec(c)} « ${(c.textContent || "").trim().slice(0, 25)} »`); }
    return [...new Set(res)].slice(0, 40);
  }).catch((e) => [`detecteur : ${e.message.slice(0, 80)}`]);
  for (const x of r) lignes.push(`NOTE detail [${nom}] ${x}`);
}
