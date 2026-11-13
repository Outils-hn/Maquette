// Maquette : lecture du fichier IFC (ou conversion d'un STEP) en arriere-plan, pour que la page reste fluide pendant le calcul.
import IFC from "./core.js?v=1.16";
self.onmessage = async (e) => {
  try {
    // resultat d'OpenCascade (fichier STEP lu dans la boite sans reseau) : on le convertit en modele
    if (e.data && e.data.step) {
      self.postMessage({ prog: 0, etape: "Conversion de la géométrie" });
      const m = IFC.depuisStep(e.data.step, { nom: e.data.nom });
      const tr = []; for (const p of m.produits) for (const x of p.morceaux) tr.push(x.T.buffer, x.A.buffer);
      self.postMessage({ ok: true, m }, tr);
      return;
    }
    const { src, ignorer } = typeof e.data === "string" || e.data instanceof Blob ? { src: e.data, ignorer: [] } : e.data;
    if (typeof src !== "string") self.postMessage({ prog: 0, etape: /\.(ifczip|zip)$/i.test(src.name || "") ? "Décompression" : "Lecture du fichier" });
    const texte = typeof src === "string" ? src : await IFC.texteIFC(src);
    // chaque etape est envoyee : si un element bloque, la page affiche son numero (#id) ; la page n'affiche qu'une mise a jour par image
    const m = IFC.build(texte, (f, etape) => self.postMessage({ prog: f, etape }), { ignorer });
    // les tableaux de geometrie sont transferes (pas copies) vers la page
    const tr = []; for (const p of m.produits) for (const x of p.morceaux) tr.push(x.T.buffer, x.A.buffer);
    self.postMessage({ ok: true, m }, tr);
  }
  catch (err) { self.postMessage({ ok: false, err: err.message }); }
};
