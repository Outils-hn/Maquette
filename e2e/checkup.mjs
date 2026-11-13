// Check-up automatique de Maquette dans un vrai navigateur (donnees du navigateur vierges).
// Resultat : checkup.txt (OK / ECHEC) + captures d'ecran + un DXF exporte.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:8090/";
const OUT = process.argv[2] ?? "captures";
mkdirSync(OUT, { recursive: true });
const lignes = [];
const verif = (nom, ok, detail = "") => { lignes.push(`${ok ? "OK    " : "ECHEC "} ${nom}${detail ? ` (${detail})` : ""}`); writeFileSync(`${OUT}/checkup.txt`, lignes.join("\n") + "\n"); };
const step = async (nom, fn) => { try { await fn(); } catch (e) { verif(nom, false, e.message.split("\n")[0].slice(0, 180)); } };
const browser = await chromium.launch();

async function ouvrir({ largeur = 1440, hauteur = 900, sombre = false } = {}) {
  const c = await browser.newContext({ viewport: { width: largeur, height: hauteur }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  await c.addInitScript((d) => { if (d) localStorage.setItem("outils-theme", "dark"); }, sombre);
  const page = await c.newPage();
  page.on("pageerror", (e) => verif("Aucune erreur JavaScript", false, e.message.slice(0, 150)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(300);
  return { c, page };
}
const exemple = async (page) => { await page.click("#bExemple"); await page.waitForFunction(() => window.__viewer?.M, null, { timeout: 15000 }); await page.waitForTimeout(400); };
const txt = (page, s) => page.locator(s).innerText().then((t) => t.replace(/\s+/g, " ").trim());
const pasDebordement = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

await step("Ecran d'accueil", async () => {
  const { c, page } = await ouvrir();
  verif("Ecran d'accueil : ouvrir un fichier ou voir un exemple", await page.locator("#accueil").isVisible() && await page.locator("#bExemple").isVisible());
  verif("Rappel : le fichier n'est envoye nulle part", /rien n'est envoyé/.test(await txt(page, ".prive")));
  verif("Bandeau : Maquette coche dans le menu des applis", await page.locator('#appsList a[aria-current="page"]').textContent().then((t) => /Maquette/.test(t)));
  verif("Listes vides et copie desactivee avant d'ouvrir un fichier", await page.locator("#bCopier").isDisabled());
  await page.screenshot({ path: `${OUT}/01-accueil.png` });
  await c.close();
});

await step("Exemple : lecture et affichage", async () => {
  const { c, page } = await ouvrir();
  await exemple(page);
  verif("Exemple ouvert (TinyHouse, IFC4)", /TinyHouse/.test(await txt(page, "#fichier")) && /IFC4/.test(await txt(page, "#infos")), await txt(page, "#infos"));
  verif("Ecran d'accueil masque une fois la maquette ouverte", await page.locator("#accueil").isHidden());
  verif("Contenu : 4 etages", (await page.locator("#arbre .etage").count()) === 4);
  verif("Fenetres et portes : 16 lignes", (await page.locator("#tables tbody tr").count()) === 16);
  verif("Vue 3D dessinee (WebGL)", await page.evaluate(() => { const cv = document.getElementById("vue"); return !!cv.getContext("webgl") && cv.width > 100; }));
  await page.screenshot({ path: `${OUT}/02-exemple.png` });
  // Choisir une fenetre dans la liste
  await page.locator("#tables td button", { hasText: "Win_Living_R1" }).click(); await page.waitForTimeout(300);
  const fiche = await txt(page, "#props");
  verif("Fiche d'une fenetre : largeur, hauteur, allege, mur", /Largeur 1 400 mm/.test(fiche) && /Hauteur 1 500 mm/.test(fiche) && /Allège.*800 mm/.test(fiche) && /Dans le mur Wall_Right/.test(fiche), fiche.slice(0, 160));
  await page.click('[data-onglet="murs"]');
  verif("Murs et surfaces : 6 murs, surfaces nettes", (await page.locator("#tables tbody tr").count()) === 6 && /Total 6 murs/.test(await txt(page, "#tables tfoot")));
  await page.click("#bCopier"); await page.waitForTimeout(300);
  const presse = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  verif("Copier pour Excel : tableau avec en-tetes, separe par tabulations", /^Nom\tÉtage\tLongueur \(mm\)/.test(presse) && presse.split("\n").length === 9, presse.slice(0, 60));
  await page.screenshot({ path: `${OUT}/03-murs.png` });
  await c.close();
});

await step("Vues, coupe et DXF", async () => {
  const { c, page } = await ouvrir();
  await exemple(page);
  await page.click('[data-plan]:nth-of-type(1) >> nth=1'); await page.waitForTimeout(400);
  verif("Plan d'un etage : vue de dessus coupee a 1 m", (await page.getAttribute('[data-vue="plan"]', "aria-pressed")) === "true" && /^1\D?680/.test(await page.inputValue("#valCoupe")), await page.inputValue("#valCoupe"));
  await page.screenshot({ path: `${OUT}/04-plan.png` });
  await page.selectOption("#axeCoupe", "x"); await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-coupe-x.png` });
  await page.click("#bDxf"); await page.waitForTimeout(300);
  verif("Fenetre DXF : apercu et nombre de lignes", (await page.locator("#apercu line").count()) > 20 && /traits/.test(await txt(page, "#dInfo")), await txt(page, "#dInfo"));
  await page.screenshot({ path: `${OUT}/06-dxf.png` });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.click("#dTelecharger")]);
  await dl.saveAs(`${OUT}/coupe.dxf`);
  verif("Telechargement du DXF", /\.dxf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.click("#dFermer");
  await page.click('[data-vue="c"]'); await page.waitForTimeout(300);
  verif("Elevation (Face C) en vue a plat", (await page.getAttribute('[data-vue="c"]', "aria-pressed")) === "true");
  await c.close();
});

await step("Facades : metre et elevation cotee", async () => {
  const { c, page } = await ouvrir();
  await exemple(page);
  await page.click('[data-onglet="fac"]'); await page.waitForTimeout(200);
  verif("Onglet Facades : 4 faces avec metre", (await page.locator("#tables tbody tr").count()) === 4 && /33,6/.test(await txt(page, "#tables")), (await txt(page, "#tables tbody tr >> nth=0")).slice(0, 80));
  await page.screenshot({ path: `${OUT}/11-facades.png` });
  await page.click('[data-vue="a"]'); await page.waitForTimeout(200);
  verif("Face A affichee : le bouton DXF exporte son elevation", !(await page.isDisabled("#bDxf")));
  await page.click("#bDxf"); await page.waitForTimeout(300);
  verif("Fenetre DXF d'elevation : cotes et niveaux", /Élévation DXF : Face A/.test(await txt(page, "#dxf-titre")) && (await page.locator("#apercu line.c-COTES").count()) > 5 && (await page.locator("#apercu text").count()) > 5, await txt(page, "#dInfo"));
  await page.screenshot({ path: `${OUT}/12-elevation.png` });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.click("#dTelecharger")]);
  await dl.saveAs(`${OUT}/elevation.dxf`);
  const t = (await import("node:fs")).readFileSync(`${OUT}/elevation.dxf`, "utf8");
  verif("Telechargement de l'elevation DXF (calques cotes et niveaux)", /elevation-face-a\.dxf$/.test(dl.suggestedFilename()) && /IFC-COTES/.test(t) && /IFC-NIVEAUX/.test(t), dl.suggestedFilename());
  await page.click("#dFermer");
  await c.close();
});

await step("Export STEP", async () => {
  const { c, page } = await ouvrir();
  await exemple(page);
  await page.click("#bStep"); await page.waitForTimeout(200);
  verif("Fenetre STEP : sans selection, l'element selectionne est grise", await page.locator('#formStep input[value="sel"]').isDisabled() && /71 pi/.test(await txt(page, "#sInfo")), await txt(page, "#sInfo"));
  await page.screenshot({ path: `${OUT}/10-step.png` });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click("#sOk")]);
  await dl.saveAs(`${OUT}/maquette.stp`);
  const t = (await import("node:fs")).readFileSync(`${OUT}/maquette.stp`, "utf8");
  verif("Telechargement du STEP (toute la maquette affichee)", /\.stp$/.test(dl.suggestedFilename()) && /^ISO-10303-21;/.test(t) && (t.match(/=PRODUCT\(/g) || []).length === 72, `${dl.suggestedFilename()} ${(t.length / 1e6).toFixed(2)} Mo`);
  verif("Toast apres l'export STEP", /STEP export/.test(await txt(page, "#toast")), await txt(page, "#toast"));
  await c.close();
});

await step("Mesure", async () => {
  const { c, page } = await ouvrir();
  await exemple(page);
  await page.click("#bMesure");
  const b = await page.locator("#vue").boundingBox();
  await page.mouse.click(b.x + b.width * 0.42, b.y + b.height * 0.5); await page.mouse.click(b.x + b.width * 0.6, b.y + b.height * 0.45); await page.waitForTimeout(300);
  verif("Mesure : distance et ecarts X, Y, Z en mm", /Distance [\d  ]+ mm/.test(await txt(page, "#props")) && /ΔZ/.test(await txt(page, "#props")), (await txt(page, "#props")).slice(0, 120));
  await page.screenshot({ path: `${OUT}/07-mesure.png` });
  await page.keyboard.press("Escape");
  verif("Echap quitte la mesure", (await page.getAttribute("#bMesure", "aria-pressed")) === "false");
  await c.close();
});

await step("Ouvrir un fichier", async () => {
  const { c, page } = await ouvrir();
  await page.setInputFiles("#ouvrir", "exemples/TinyHouse.ifc");
  await page.waitForFunction(() => window.__viewer?.M, null, { timeout: 15000 });
  verif("Fichier choisi sur le poste : ouvert", (await txt(page, "#fichier")) === "TinyHouse.ifc");
  // archive .ifczip (le format compresse que les architectes envoient souvent)
  const { deflateRawSync } = await import("node:zlib"); const { readFileSync } = await import("node:fs");
  const data = readFileSync("exemples/TinyHouse.ifc"), comp = deflateRawSync(data), nm = Buffer.from("TinyHouse.ifc");
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(nm.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nm.length, 28);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + nm.length, 12); fin.writeUInt32LE(30 + nm.length + comp.length, 16);
  await page.setInputFiles("#ouvrir", { name: "Maquette.ifczip", mimeType: "application/zip", buffer: Buffer.concat([loc, nm, comp, cen, nm, fin]) });
  await page.waitForFunction(() => document.querySelector("#fichier")?.textContent === "Maquette.ifczip", null, { timeout: 15000 }).catch(() => {});
  verif("Archive .ifczip ouverte", (await txt(page, "#fichier")) === "Maquette.ifczip" && (await page.evaluate(() => window.__viewer?.M?.produits.length)) === 71, await txt(page, "#fichier"));
  await page.setInputFiles("#ouvrir", { name: "plan.dwg", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await page.waitForTimeout(300);
  verif("Autre format refuse avec un message clair", /fichier \.ifc/.test(await txt(page, "#toast")), await txt(page, "#toast"));
  await c.close();
});

await step("Fichier STEP (OpenCascade dans une boite sans reseau)", async () => {
  const { c, page } = await ouvrir();
  const origine = new URL(BASE).origin, sortis = [];
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith(origine) && !u.startsWith("data:") && !u.startsWith("blob:") && !/fonts\.(googleapis|gstatic)\.com/.test(u)) sortis.push(u); });
  // 1. la boite est etanche : chaque tentative de sortie de donnees est refusee par la politique de securite
  const t = await page.evaluate((u) => window.__viewer.testerBoite(u), BASE + "index.html");
  verif("Boite STEP : fetch, XHR, balise, WebSocket et image bloques (CSP)", t.boite.passe.length === 0 && t.boite.viol.length >= 5 && t.boite.viol.includes("connect-src") && t.boite.viol.includes("img-src"), JSON.stringify(t.boite));
  verif("Boite STEP : son travailleur est aussi coupe du reseau (fetch, importScripts, WebSocket)", t.travailleur.passe.length === 0 && t.travailleur.viol.length >= 3, JSON.stringify(t.travailleur));
  // 2. ouverture d'un STEP (celui que Maquette exporte lui-meme depuis l'exemple : dimensions connues)
  const { readFileSync } = await import("node:fs"); const { default: IFC } = await import("../js/core.js");
  const M0 = IFC.build(readFileSync("exemples/TinyHouse.ifc", "utf8"));
  const stp = IFC.step(M0, M0.produits.map((_, i) => i), { fichier: "TinyHouse.stp", nom: "TinyHouse" }).texte;
  await page.setInputFiles("#ouvrir", { name: "TinyHouse.stp", mimeType: "application/step", buffer: Buffer.from(stp) });
  await page.waitForFunction(() => window.__viewer?.M?.source === "step", null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => { const M = window.__viewer.M; const b = M.bbTout; return { n: M.produits.length, g: M.etages.length, bb: [b.min, b.max].map((a) => a.map((v) => +v.toFixed(2))), nrm: M.produits.every((p) => p.morceaux.every((m) => m.T.length > 0)), ar: M.produits.some((p) => p.morceaux.some((m) => m.A.length > 0)) }; });
  verif("STEP ouvert : 110 solides, dimensions identiques a l'IFC d'origine (mm exacts)", info.n === 110 && JSON.stringify(info.bb) === JSON.stringify([[-0.42, -0.17, 0], [12.25, 3.47, 4.01]]), JSON.stringify(info));
  verif("STEP : triangles et aretes presents", info.nrm && info.ar);
  verif("STEP : en-tete (format, nombre de pieces)", /STEP/.test(await txt(page, "#infos")) && /110 pièces/.test(await txt(page, "#infos")), await txt(page, "#infos"));
  verif("STEP : les sous-ensembles remplacent les etages (pas de cote ni de bouton Plan)", (await page.locator("#arbre .etage").count()) === info.g && (await page.locator("#arbre [data-plan]").count()) === 0);
  verif("STEP : onglets Fenetres / Murs / Facades masques, liste des pieces affichee", (await page.locator('[data-onglet="fen"]').isHidden()) && (await page.locator('[data-onglet="fac"]').isHidden()) && /Sous-ensemble/.test(await txt(page, "#tables thead")) && (await page.locator("#tables tbody tr").count()) === 110);
  verif("STEP : export STEP desactive (c'est deja un STEP)", await page.locator("#bStep").isDisabled());
  await page.locator("#tables td button", { hasText: "Wall_Left" }).first().click(); await page.waitForTimeout(300);
  const fiche = await txt(page, "#props");
  verif("STEP : fiche d'une piece (sous-ensemble, surface, volume, encombrement)", /Sous-ensemble/.test(fiche) && /Surface .* cm²/.test(fiche) && /Volume .* cm³/.test(fiche) && /X 10 500 mm/.test(fiche) && /Y 150 mm/.test(fiche), fiche.slice(0, 200));
  await page.screenshot({ path: `${OUT}/10-step.png` });
  verif("STEP : la liste porte la mention « à contrôler »", /à contrôler/i.test(await txt(page, "#avertListe")), await txt(page, "#avertListe"));
  verif("STEP : boutons de vue renommes (Dessus, Avant, Droite, Arrière, Gauche, Dessous)", (await page.locator("[data-vue]:visible").allTextContents()).join(",") === "3D,Dessus,Avant,Droite,Arrière,Gauche,Dessous", (await page.locator("[data-vue]:visible").allTextContents()).join(","));
  verif("STEP : DXF desactive en 3D, active dans une vue", await page.isDisabled("#bDxf"));
  await page.click('[data-vue="a"]'); await page.waitForTimeout(300);
  verif("STEP : DXF actif dans la vue avant", await page.isEnabled("#bDxf"));
  await page.click("#bDxf");
  await page.waitForFunction(() => /traits/.test(document.querySelector("#dInfo")?.textContent || ""), null, { timeout: 60000 });
  const infoV = await txt(page, "#dInfo");
  verif("STEP : fenetre DXF de la vue (apercu, cotes, mention a controler)", (await page.locator("#apercu line").count()) > 20 && (await page.locator("#apercu text").count()) > 0 && /à contrôler/i.test(await txt(page, "#dAvert")) && /vue-avant\.dxf/.test(infoV) && await page.locator("#lCaches").isVisible() && await page.locator("#lVus").isHidden(), infoV);
  await page.screenshot({ path: `${OUT}/12-step-vue-dxf.png` });
  await page.uncheck("#dCaches"); await page.uncheck("#dGen"); await page.uncheck("#dTrous");
  await page.waitForFunction(() => document.querySelectorAll("#apercu .c-CACHE").length === 0 && document.querySelectorAll("#apercu text").length === 0, null, { timeout: 60000 });
  verif("STEP : sans cotes la mention disparait, sans aretes cachees plus de tirets", await page.locator("#dAvert").isHidden());
  await page.check("#dCaches"); await page.check("#dGen"); await page.check("#dTrous");
  await page.waitForFunction(() => document.querySelectorAll("#apercu .c-CACHE").length > 0, null, { timeout: 60000 });
  const [dlv] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click("#dTelecharger")]);
  await dlv.saveAs(`${OUT}/vue-avant.dxf`);
  const dv = readFileSync(`${OUT}/vue-avant.dxf`, "utf8");
  verif("STEP : DXF de la vue (calques STEP-, tirets, cotes, mention a controler)", dlv.suggestedFilename() === "TinyHouse-vue-avant.dxf" && /STEP-VISIBLE/.test(dv) && /STEP-CACHE/.test(dv) && /DASHED/.test(dv) && /A CONTROLER/.test(dv) && /STEP-COTES/.test(dv), `${dlv.suggestedFilename()} ${dv.length} o`);
  await page.click("#dFermer");
  // position exacte de la coupe : valeur tapee, fleches, boutons
  await page.evaluate(() => window.__viewer.poserCoupe("z", 1.5)); await page.waitForTimeout(200);
  verif("Coupe : la position exacte s'affiche en mm", /^1\D?500$/.test(await page.inputValue("#valCoupe")), await page.inputValue("#valCoupe"));
  await page.fill("#valCoupe", "1 234,5"); await page.press("#valCoupe", "Enter"); await page.waitForTimeout(200);
  const vc = () => page.evaluate(() => Math.round(window.__viewer.etat.coupe.v * 10000) / 10);
  verif("Coupe : valeur tapee (1 234,5 mm) appliquee au dixieme de mm", (await vc()) === 1234.5, String(await vc()));
  await page.press("#valCoupe", "ArrowUp"); await page.press("#valCoupe", "Shift+ArrowUp"); await page.press("#valCoupe", "Alt+ArrowDown"); await page.waitForTimeout(200);
  verif("Coupe : fleches ±1 mm, Maj ±10 mm, Alt ±0,1 mm", (await vc()) === 1234.5 + 1 + 10 - 0.1, String(await vc()));
  await page.click("#coupePlus"); await page.click("#coupeMoins", { modifiers: ["Shift"] }); await page.waitForTimeout(200);
  verif("Coupe : boutons + et − (Maj = 10 mm)", (await vc()) === 1234.5 + 1 + 10 - 0.1 + 1 - 10, String(await vc()));
  await page.focus("#hauteur"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  verif("Coupe : le curseur reagit aussi aux fleches (±1 mm)", (await vc()) === 1234.5 + 1 + 10 - 0.1 + 1 - 10 + 1, String(await vc()));
  await page.fill("#valCoupe", "999999"); await page.press("#valCoupe", "Enter"); await page.waitForTimeout(200);
  verif("Coupe : valeur hors maquette ramenee a la limite, avec message", /Hors de la maquette/.test(await txt(page, "#toast")) && (await vc()) < 50000, await txt(page, "#toast"));
  await page.fill("#valCoupe", "abc"); await page.press("#valCoupe", "Enter"); await page.waitForTimeout(150);
  verif("Coupe : texte non numerique refuse sans changer la coupe", /Valeur non reconnue/.test(await txt(page, "#toast")) && /\d/.test(await page.inputValue("#valCoupe")));
  await page.evaluate(() => { window.__viewer.poserCoupe("z", 1.5); window.__viewer.vue("plan"); }); await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/11-step-plan.png` });
  // retour a un IFC : onglets, pastilles de type et export STEP reviennent
  await page.setInputFiles("#ouvrir", { name: "TinyHouse.ifc", mimeType: "application/octet-stream", buffer: readFileSync("exemples/TinyHouse.ifc") });
  await page.waitForFunction(() => window.__viewer?.M?.source !== "step" && window.__viewer?.M?.produits.length === 71, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  verif("IFC : la liste des fenetres porte la mention « à contrôler »", /à contrôler/i.test(await txt(page, "#avertListe")));
  verif("IFC : vues A a D et Plan reprennent leurs noms, Dessous masque", (await page.locator("[data-vue]:visible").allTextContents()).join(",") === "3D,Plan,A,B,C,D");
  verif("Retour a un IFC apres un STEP : onglets, pastilles de type et export STEP reviennent", await page.locator('[data-onglet="fen"]').isVisible() && await page.locator("#filtres").isVisible() && await page.locator("#bStep").isEnabled() && (await page.locator("#arbre .etage").count()) === 4 && /Étage|Fenêtres/.test(await txt(page, ".listes-tete")));
  // 3. fichier STEP illisible : message clair, rien ne casse
  await page.setInputFiles("#ouvrir", { name: "vide.stp", mimeType: "application/step", buffer: Buffer.from("ceci n'est pas un STEP") });
  await page.waitForFunction(() => /STEP/.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
  verif("STEP illisible : message clair", /Impossible de lire ce fichier STEP/.test(await txt(page, "#toast")), await txt(page, "#toast"));
  // 4. rien n'est parti vers un autre site pendant tout cela
  verif("STEP : aucune requete vers un autre site", sortis.length === 0, sortis.slice(0, 3).join(" "));
  await c.close();
});

await step("Lecteur STEP : un fichier du moteur modifie est refuse", async () => {
  const c = await browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: "block" });
  const page = await c.newPage();
  await page.route("**/vendor/occt/occt-import-js.js", (r) => r.fulfill({ body: "self.piege = 1;", contentType: "text/javascript" }));
  await page.goto(BASE, { waitUntil: "load" });
  const { readFileSync } = await import("node:fs");
  await page.setInputFiles("#ouvrir", { name: "piece.stp", mimeType: "application/step", buffer: readFileSync(new URL("../exemples/TinyHouse.ifc", import.meta.url)).subarray(0, 200) });
  await page.waitForFunction(() => /STEP/.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 30000 });
  const t = await txt(page, "#toast");
  verif("Moteur STEP altere : empreinte differente, lecteur non lance", /empreinte inattendue/.test(t) && !(await page.evaluate(() => window.__viewer?.M)), t);
  await c.close();
});

await step("Telephone et theme sombre", async () => {
  const { c, page } = await ouvrir({ largeur: 390, hauteur: 844 });
  await exemple(page);
  verif("Telephone : pas de debordement horizontal", await pasDebordement(page));
  await page.screenshot({ path: `${OUT}/08-telephone.png`, fullPage: true });
  await c.close();
  const s = await ouvrir({ sombre: true });
  await exemple(s.page);
  verif("Theme sombre applique", (await s.page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await s.page.screenshot({ path: `${OUT}/09-sombre.png` });
  await s.c.close();
});

await step("Comparaison de deux versions", async () => {
  const { readFileSync } = await import("node:fs");
  const { c, page } = await ouvrir();
  verif("Comparer : bouton inactif sans maquette", await page.isDisabled("#bCompare"));
  await exemple(page);
  verif("Comparer : bouton actif une fois une maquette ouverte", await page.isEnabled("#bCompare"));
  const ifc = readFileSync("exemples/TinyHouse.ifc", "utf8"), v2 = ifc.replaceAll("'Win_Living_L'", "'Win_Living_X'");
  await page.setInputFiles("#ouvrir3", { name: "TinyHouse-v2.ifc", mimeType: "application/octet-stream", buffer: Buffer.from(v2) });
  await page.waitForSelector("#zoneCmp:not([hidden])", { timeout: 20000 });
  verif("Comparer : la barre s'affiche avec les deux noms", /TinyHouse.*→.*TinyHouse-v2\.ifc/.test(await page.locator("#cmpNoms").textContent()), await txt(page, "#cmpNoms"));
  const chips = await page.locator(".chip-cmp").evaluateAll((L) => L.map((b) => `${b.dataset.cmps}:${b.querySelector("b").textContent}:${b.disabled}`));
  verif("Comparer : 1 modifie, rien d'ajoute, de supprime ni de deplace", chips.join(",") === "supprime:0:true,ajoute:0:true,modifie:1:false,deplace:0:true", chips.join(","));
  verif("Comparer : onglet Ecarts actif, la ligne et son detail sont la", await page.locator('[data-onglet="ecarts"][aria-selected="true"]').count() === 1 && /Win_Living_X/.test(await txt(page, "#tables")) && /Nom : Win_Living_L → Win_Living_X/.test(await txt(page, "#tables")));
  verif("Comparer : la liste porte la mention a controler", /à contrôler/i.test(await txt(page, "#avertListe")));
  await page.click("#tables [data-pi]"); await page.waitForFunction(() => /Comparaison/.test(document.querySelector("#props")?.textContent || ""), null, { timeout: 5000 }).catch(() => {});
  verif("Comparer : la fiche indique le statut et le detail", /comparaison/i.test(await txt(page, "#props")) && /Modifié/i.test(await txt(page, "#props")) && /Win_Living_X/.test(await txt(page, "#props")));
  await page.screenshot({ path: `${OUT}/13-comparaison.png` });
  await page.click('[data-cmps="modifie"]'); await page.waitForTimeout(150);
  verif("Comparer : filtre de statut (liste vide quand il est decoche)", /Aucun écart/.test(await txt(page, "#tables")));
  await page.click('[data-cmps="modifie"]'); await page.waitForTimeout(150);
  verif("Comparer : filtre rearme", /Win_Living_X/.test(await txt(page, "#tables")));
  const vis = (opt) => page.evaluate(() => window.__viewer.M.produits.filter((_, i) => window.__viewer.visible(i)).length);
  const avecFond = await vis(); await page.uncheck("#cmpFond"); await page.waitForTimeout(150); const sansFond = await vis();
  verif("Comparer : « pieces identiques en fond » masque ou montre les pieces inchangees", avecFond > 20 && sansFond === 1, `${avecFond} / ${sansFond}`);
  await page.check("#cmpFond");
  await page.click("#cmpInverser"); await page.waitForTimeout(400);
  verif("Comparer : inverser echange ancienne et nouvelle version", /^TinyHouse-v2\.ifc.*→.*TinyHouse/.test(await page.locator("#cmpNoms").textContent()) && /Win_Living_L/.test(await txt(page, "#tables")), await page.locator("#cmpNoms").textContent());
  const { default: IFCm } = await import("../js/core.js"), M0 = IFCm.build(ifc);
  const stp = IFCm.step(M0, M0.produits.map((_, i) => i), { fichier: "autre.stp", nom: "autre" }).texte;
  await page.setInputFiles("#ouvrir3", { name: "autre.stp", mimeType: "application/step", buffer: Buffer.from(stp) });
  await page.waitForFunction(() => /même type/.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 60000 });
  verif("Comparer : un IFC et un STEP ne se comparent pas (message clair)", await page.locator("#zoneCmp").isVisible());
  await page.click("#cmpQuitter"); await page.waitForTimeout(300);
  verif("Comparer : quitter ramene a la maquette normale", await page.locator("#zoneCmp").isHidden() && await page.locator('[data-onglet="ecarts"]').isHidden() && await page.locator('[data-onglet="fen"]').isVisible());
  await c.close();
});

await browser.close();
verif("Fin du check-up", true);
