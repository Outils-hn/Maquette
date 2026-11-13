// Maquette : lecture du fichier IFC en arriere-plan, pour que la page reste fluide pendant le calcul.
import IFC from "./core.js?v=1.5";
self.onmessage = async (e) => {
  try {
    const src = e.data;
    const texte = typeof src === "string" ? src : await IFC.texteIFC(src);
    let der = 0;
    const m = IFC.build(texte, (f) => { const t = Date.now(); if (t - der > 250) { der = t; self.postMessage({ prog: f }); } });
    // les tableaux de geometrie sont transferes (pas copies) vers la page
    const tr = []; for (const p of m.produits) for (const x of p.morceaux) tr.push(x.T.buffer, x.A.buffer);
    self.postMessage({ ok: true, m }, tr);
  }
  catch (err) { self.postMessage({ ok: false, err: err.message }); }
};
