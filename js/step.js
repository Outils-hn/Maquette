// Maquette : lecture des fichiers STEP (.stp / .step) avec OpenCascade (occt-import-js, compile en WebAssembly).
//
// Le moteur est du code tiers (vendor/occt/, voir LISEZMOI.md). Il est donc enferme dans une « boite » :
//  - les deux fichiers sont verifies par empreinte SHA-256 avant d'etre lances (version figee) ;
//  - ils tournent dans une iframe isolee (sandbox sans acces a la page, au stockage, aux cookies) ;
//  - la politique de securite (CSP) de cette iframe interdit toute connexion sortante, et le travailleur qu'elle cree en herite.
// Le fichier STEP entre dans la boite, la geometrie en sort par postMessage : rien d'autre ne peut en sortir.
// Si la boite ne peut pas etre montee (navigateur ou poste trop restreint), on abandonne : jamais de lecture « sans boite ».

const DOSSIER = new URL("../vendor/occt/", import.meta.url);
const EMPREINTES = {
  "occt-import-js.js": "8b090be386bc8ffba32222aa19f38742ae8ed35707819beb7f8ab4938a28c97a",
  "occt-import-js.wasm": "33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952",
};
// maillage : ecart lineaire = 0,1 % de la taille de la piece ; ecart angulaire 0,2 rad (~11 degres)
const PARAMS = { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.2 };
const DELAI_MAX = 5 * 60 * 1000;

// 'unsafe-eval' : embind (la colle JavaScript d'OpenCascade) fabrique ses fonctions d'appel avec « new Function » a partir de chaines internes
// (types C++), jamais a partir du fichier STEP. Ca ne donne aucun acces au reseau : celui-ci reste coupe par connect-src, img-src, etc.
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

// Code execute DANS le travailleur de la boite, a la suite du chargeur OpenCascade
const CODE_TRAVAILLEUR = `
self.addEventListener("message", async (ev) => {
  const d = ev.data || {};
  if (d.t === "test") { self.postMessage({ t: "test", ...(await essaiReseau(d.cible)) }); return; }
  try {
    const occt = await occtimportjs({ wasmBinary: d.wasm });
    const r = occt.ReadStepFile(new Uint8Array(d.fichier), d.params);
    if (!r || !r.success) { self.postMessage({ ok: false, err: "fichier STEP illisible ou vide" }); return; }
    const noeud = (n) => ({ nom: n.name || "", meshes: Array.from(n.meshes || []), enfants: (n.children || []).map(noeud) });
    const meshes = r.meshes.map((m) => ({
      nom: m.name || "", couleur: m.color ? Array.from(m.color) : null,
      pos: Float64Array.from(m.attributes.position.array), idx: Uint32Array.from(m.index.array),
      faces: (m.brep_faces || []).map((f) => [f.first, f.last, f.color ? Array.from(f.color) : null]),
    }));
    self.postMessage({ ok: true, res: { meshes, racine: noeud(r.root) } }, meshes.flatMap((m) => [m.pos.buffer, m.idx.buffer]));
  } catch (err) { self.postMessage({ ok: false, err: String((err && err.message) || err) }); }
});
// Essai de sortie de donnees depuis le travailleur : chaque tentative doit etre refusee par la CSP
async function essaiReseau(cible) {
  const viol = []; self.addEventListener("securitypolicyviolation", (e) => viol.push(e.violatedDirective));
  const passe = [];
  try { await fetch(cible, { mode: "no-cors" }); passe.push("fetch"); } catch (e) { /* refuse : normal */ }
  try { importScripts(cible); passe.push("importScripts"); } catch (e) { /* refuse : normal */ }
  try { const s = new WebSocket(cible.replace(/^http/, "ws")); s.onopen = () => {}; s.onerror = () => {}; } catch (e) { /* refuse : normal */ }
  await new Promise((r) => setTimeout(r, 300));
  return { passe, viol };
}
`;

// Page de la boite (srcdoc) : recoit les octets du chargeur, du moteur et du fichier, cree le travailleur, renvoie la geometrie
const PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>
const hote = window.parent; let w = null, glue = "";
const envoyer = (m, tr) => hote.postMessage(m, "*", tr || []);
const CODE = ${JSON.stringify(CODE_TRAVAILLEUR)};
function monter(g) {
  const src = URL.createObjectURL(new Blob([g, "\\n;", CODE], { type: "text/javascript" }));
  w = new Worker(src);
  w.onerror = (e) => { e.preventDefault(); envoyer({ t: "fin", ok: false, err: "le lecteur STEP n'a pas pu démarrer sur ce poste" }); };
  w.onmessage = (m) => {
    const d = m.data;
    if (d.t === "test") { envoyer({ t: "testTrav", passe: d.passe, viol: d.viol }); return; }
    const tr = []; if (d.ok) for (const x of d.res.meshes) tr.push(x.pos.buffer, x.idx.buffer);
    envoyer({ t: "fin", ...d }, tr);
  };
}
addEventListener("message", async (e) => {
  if (e.source !== hote) return;
  const d = e.data || {};
  try {
    if (d.t === "lire") { monter(d.glue); w.postMessage({ wasm: d.wasm, fichier: d.fichier, params: d.params }, [d.wasm, d.fichier]); }
    else if (d.t === "test") {
      const viol = [], passe = []; addEventListener("securitypolicyviolation", (v) => viol.push(v.violatedDirective));
      const cible = d.cible;
      try { await fetch(cible, { mode: "no-cors" }); passe.push("fetch"); } catch (x) { /* refuse */ }
      try { await new Promise((ok, ko) => { const r = new XMLHttpRequest(); r.open("GET", cible); r.onload = ok; r.onerror = ko; r.send(); }); passe.push("xhr"); } catch (x) { /* refuse */ }
      try { navigator.sendBeacon(cible, "x"); } catch (x) { /* refuse */ }
      try { const s = new WebSocket(cible.replace(/^http/, "ws")); s.onerror = () => {}; } catch (x) { /* refuse */ }
      try { const i = new Image(); i.src = cible; } catch (x) { /* refuse */ }
      await new Promise((r) => setTimeout(r, 300));
      envoyer({ t: "testBoite", passe, viol });
      monter("var occtimportjs;"); w.postMessage({ t: "test", cible });
    }
  } catch (err) { envoyer({ t: "fin", ok: false, err: String((err && err.message) || err) }); }
});
envoyer({ t: "pret" });
</script>`;

async function charger(nom) {
  const rep = await fetch(new URL(nom, DOSSIER));
  if (!rep.ok) throw new Error(`fichier du lecteur STEP introuvable (${nom}, code ${rep.status})`);
  const octets = await rep.arrayBuffer();
  if (!(globalThis.crypto && crypto.subtle)) throw new Error("vérification d'empreinte impossible (page non sécurisée)");
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", octets))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (h !== EMPREINTES[nom]) throw new Error(`empreinte inattendue pour ${nom} : le lecteur STEP n'est pas lancé`);
  return octets;
}

// Monte la boite et attend son signal « pret » ; recoit ensuite les messages via recevoir(fn)
function monterBoite() {
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-scripts"); f.setAttribute("referrerpolicy", "no-referrer"); f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
  f.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  const ecouteurs = new Set();
  const surMessage = (e) => { if (e.source === f.contentWindow) for (const fn of ecouteurs) fn(e.data); };
  window.addEventListener("message", surMessage);
  const pret = new Promise((ok, ko) => { ecouteurs.add((d) => { if (d.t === "pret") ok(); }); setTimeout(() => ko(new Error("la boîte du lecteur STEP ne répond pas")), 10000); });
  f.srcdoc = PAGE; document.body.appendChild(f);
  return {
    pret, ecouteurs,
    envoyer: (m, tr) => f.contentWindow.postMessage(m, "*", tr || []),
    fermer: () => { window.removeEventListener("message", surMessage); f.remove(); },
  };
}

// Lit un fichier STEP : renvoie { meshes: [{ nom, couleur, pos (mm), idx, faces }], racine } ; etat(texte) informe de l'avancement
export async function lireStep(fichier, etat = () => {}) {
  etat("Chargement du lecteur STEP");
  const [glue, wasm] = await Promise.all([charger("occt-import-js.js"), charger("occt-import-js.wasm")]);
  etat("Lecture du fichier");
  const octets = await fichier.arrayBuffer();
  const boite = monterBoite();
  try {
    await boite.pret;
    etat("Lecture du STEP (OpenCascade)");
    return await new Promise((ok, ko) => {
      const minuterie = setTimeout(() => ko(new Error("lecture trop longue (plus de 5 minutes) : fichier trop lourd pour ce poste ?")), DELAI_MAX);
      boite.ecouteurs.add((d) => { if (d.t !== "fin") return; clearTimeout(minuterie); d.ok ? ok(d.res) : ko(new Error(d.err || "lecture impossible")); });
      boite.envoyer({ t: "lire", glue: new TextDecoder().decode(glue), wasm, fichier: octets, params: PARAMS }, [wasm, octets]);
    });
  } finally { boite.fermer(); }
}

// Verification de l'etancheite de la boite (utilisee par le test automatique) : tente de faire sortir des donnees
// depuis la boite et depuis son travailleur ; cible = une adresse qui repondrait si la tentative passait
export async function testerBoite(cible) {
  const boite = monterBoite();
  try {
    await boite.pret;
    const recu = {};
    return await new Promise((ok, ko) => {
      const minuterie = setTimeout(() => ko(new Error("test de la boîte sans réponse")), 15000);
      boite.ecouteurs.add((d) => { if (d.t === "testBoite") recu.boite = d; if (d.t === "testTrav") { recu.travailleur = d; clearTimeout(minuterie); ok(recu); } });
      boite.envoyer({ t: "test", cible });
    });
  } finally { boite.fermer(); }
}
