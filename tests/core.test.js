// Tests du moteur IFC sur la maquette d'exemple (TinyHouse) et sur de petits cas construits a la main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import IFC from "../js/core.js";

const M = IFC.build(readFileSync(new URL("../exemples/TinyHouse.ifc", import.meta.url), "utf8"));
const parNom = (n) => M.produits.find((p) => p.nom === n);

test("lecture de l'exemple : format, logiciel, etages, elements", () => {
  assert.equal(M.schema, "IFC4");
  assert.equal(M.projet, "TinyHouse");
  assert.match(M.logiciel, /FreeCAD/);
  assert.deepEqual(M.etages.map((e) => e.nom), ["Chassis", "MainFloor", "LoftLevel", "RoofLevel"]);
  assert.equal(M.etages[1].elev, 0.68);
  assert.equal(M.produits.length, 71);
  assert.equal(M.produits.filter((p) => p.ifc === "IFCWALL").length, 6);
  assert.equal(M.produits.filter((p) => p.ifc === "IFCWINDOW" || p.ifc === "IFCDOOR").length, 16);
  assert.deepEqual(M.avertissements, []);
});

test("murs : dimensions et surface nette une fois les ouvertures decoupees", () => {
  const w = parNom("Wall_Left");
  assert.equal(w.materiau, "Holzrahmenwand 60x120 C24 e600");
  assert.equal(Math.round(w.surf.L * 1000), 10500);
  assert.equal(Math.round(w.surf.h * 1000), 3200);
  assert.equal(Math.round(w.surf.T * 1000), 150);
  assert.ok(Math.abs(w.surf.brute - 33.6) < 1e-9);
  assert.ok(w.surf.nette < w.surf.brute && w.surf.nette > 20);
  assert.equal(w.surf.trous, 9);
});

test("fenetres : dimensions (mm meme si le fichier est en metres), etage et mur porteur", () => {
  const f = parNom("Win_Living_R1");
  assert.equal(f.largeur, 1400);
  assert.equal(f.hauteur, 1500);
  assert.equal(M.etages.find((e) => e.id === f.etage).nom, "MainFloor");
  assert.equal(M.produits.find((p) => p.id === f.mur).nom, "Wall_Right");
  assert.ok(f.morceaux.some((m) => m.verre), "la vitre est reconnue");
});

test("coupe horizontale : traits des murs, fenetres et vitrages, sans doublon", () => {
  const segs = IFC.couper(M, { axe: "z", v: 1.68 });
  const calques = new Set(segs.map((s) => s.calque));
  for (const c of ["MUR", "FENETRE", "VITRAGE", "PORTE"]) assert.ok(calques.has(c), c);
  const cles = segs.map((s) => [s.calque, ...s.a, ...s.b].map((v) => (typeof v === "number" ? v.toFixed(4) : v)).join(","));
  assert.equal(new Set(cles).size, cles.length);
  const xs = segs.flatMap((s) => [s.a[0], s.b[0]]);
  assert.ok(Math.abs(Math.min(...xs)) < 1e-6 && Math.abs(Math.max(...xs) - 10.5) < 1e-6, "le plan fait 10,5 m de long");
});

test("DXF : entete R12, calques IFC-, coordonnees en mm, fin de fichier", () => {
  const d = IFC.dxf(IFC.couper(M, { axe: "x", v: 4.7 }), "Coupe é test");
  const L = d.split("\r\n");
  assert.equal(L[L.length - 2], "EOF");
  assert.ok(d.includes("AC1009"));
  assert.ok(d.includes("IFC-MUR") && d.includes("IFC-TOITURE"));
  assert.ok(d.includes("Coupe e test"), "texte sans accent pour AutoCAD");
  const ys = []; for (let i = 0; i < L.length - 1; i += 2) if (L[i] === "21") ys.push(+L[i + 1]);
  assert.ok(Math.max(...ys) > 3000, "hauteurs en mm");
});

test("petit fichier construit a la main : unites en mm, extrusion, propriete, chaine accentuee", () => {
  const ifc = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC2X3'));ENDSEC;DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#2=IFCPROJECT('p',$,'Essai',$,$,$,$,$,$);
#3=IFCBUILDINGSTOREY('s',$,'Rez',$,$,$,$,$,.ELEMENT.,0.);
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCAXIS2PLACEMENT3D(#10,$,$);
#12=IFCLOCALPLACEMENT($,#11);
#13=IFCAXIS2PLACEMENT2D(#10,$);
#14=IFCRECTANGLEPROFILEDEF(.AREA.,$,#13,2000.,200.);
#15=IFCDIRECTION((0.,0.,1.));
#16=IFCEXTRUDEDAREASOLID(#14,#11,#15,3000.);
#17=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#16));
#18=IFCPRODUCTDEFINITIONSHAPE($,$,(#17));
#19=IFCWALL('w',$,'Mur b\\X2\\00E9\\X0\\ton',$,$,#12,#18,$);
#20=IFCRELCONTAINEDINSPATIALSTRUCTURE('r',$,$,$,(#19),#3);
#21=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCREAL(0.18),$);
#22=IFCPROPERTYSET('ps',$,'Pset_WallCommon',$,(#21));
#23=IFCRELDEFINESBYPROPERTIES('d',$,$,$,(#19),#22);
ENDSEC;END-ISO-10303-21;`;
  const m = IFC.build(ifc);
  const w = m.produits[0];
  assert.equal(w.nom, "Mur béton");
  assert.equal(m.etages[0].nom, "Rez");
  assert.equal(w.etage, m.etages[0].id);
  assert.ok(Math.abs(w.bb.max[2] - 3) < 1e-9 && Math.abs(w.bb.max[0] - 1) < 1e-9, "3000 mm -> 3 m");
  assert.equal(w.psets[0].nom, "Pset_WallCommon");
  assert.equal(w.psets[0].props[0].val, "0.18");
  assert.ok(w.surf && Math.abs(w.surf.brute - 6) < 1e-9);
});

test("triangulation d'un polygone a trou et soustraction de polygones convexes", () => {
  const tris = IFC.triangulate([[0, 0], [4, 0], [4, 4], [0, 4]], [[[1, 1], [3, 1], [3, 3], [1, 3]]]);
  const aire = tris.reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);
  assert.ok(Math.abs(aire - 12) < 1e-9);
  const pieces = IFC.subtractConvex([[0, 0], [4, 0], [4, 4], [0, 4]], [[1, 1], [3, 1], [3, 3], [1, 3]]);
  const aire2 = pieces.reduce((s, P) => { let t = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; t += a[0] * b[1] - b[0] * a[1]; } return s + Math.abs(t) / 2; }, 0);
  assert.ok(Math.abs(aire2 - 12) < 1e-9);
});

test("export STEP : assemblage AP214 en mm, une piece par element, faces planes", () => {
  const tout = IFC.step(M, M.produits.map((_, i) => i), { fichier: "t.stp", nom: "TinyHouse" });
  const t = tout.texte;
  assert.match(t, /^ISO-10303-21;/);
  assert.match(t, /AUTOMOTIVE_DESIGN/);
  assert.match(t, /SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
  assert.match(t, /END-ISO-10303-21;\s*$/);
  assert.equal(tout.nbPieces, 71);
  assert.equal((t.match(/=PRODUCT\(/g) || []).length, 72);
  assert.equal((t.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g) || []).length, 71);
  // vrais solides B-rep (AutoCAD les importe en solides 3D, pas en maillage)
  assert.equal((t.match(/=FACETED_BREP\(/g) || []).length, 0);
  assert.ok(tout.nbSolides >= 100, String(tout.nbSolides));
  assert.ok(tout.nbSurfaces <= 2, String(tout.nbSurfaces));
  assert.equal((t.match(/=MANIFOLD_SOLID_BREP\(/g) || []).length, tout.nbSolides);
  // les references #n pointent toutes vers des entites definies
  const def = new Set([...t.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  for (const m of t.matchAll(/#(\d+)/g)) assert.ok(def.has(m[1]), "#" + m[1]);
  // un mur avec ses ouvertures : faces planes trouees plutot que des triangles
  const i = M.produits.findIndex((p) => p.nom === "Wall_Left");
  const w = IFC.step(M, [i]);
  assert.equal(w.nbPieces, 1);
  assert.ok(w.nbFaces < 100, String(w.nbFaces));
  assert.ok(/FACE_BOUND\(/.test(w.texte));
  assert.equal(w.nbSolides, 1);
  // solide ferme : chaque arete est parcourue une fois dans chaque sens
  const sens = new Map();
  for (const m of w.texte.matchAll(/ORIENTED_EDGE\('',\*,\*,#(\d+),\.(T|F)\.\)/g)) { const s = sens.get(m[1]) || { T: 0, F: 0 }; s[m[2]]++; sens.set(m[1], s); }
  assert.ok(sens.size > 0);
  for (const [k, s] of sens) assert.ok(s.T === 1 && s.F === 1, "arete #" + k + " " + JSON.stringify(s));
  // coordonnees en mm : le mur fait 10,5 m de long
  const xs = [...w.texte.matchAll(/CARTESIAN_POINT\('',\(([-\d.E+]+),([-\d.E+]+),([-\d.E+]+)\)\)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  const ext = [0, 1, 2].map((k) => Math.max(...xs.map((p) => p[k])) - Math.min(...xs.map((p) => p[k])));
  assert.ok(ext.some((e) => Math.abs(e - 10500) < 2), ext.join(" "));
});

test("export STEP : noms accentues encodes", () => {
  assert.equal(IFC.stepStr("Façade d'été"), "'Fa\\X2\\00E7\\X0\\ade d''\\X2\\00E9\\X0\\t\\X2\\00E9\\X0\\'");
});

// Petit fichier facon Revit / ArchiCAD : deux unites de longueur declarees, mur trapeze (onglets) perce, profil avec arc, mur coupe par un plan
const VRAI = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#2=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#4=IFCUNITASSIGNMENT((#1));
#5=IFCPROJECT('p',$,'Essai',$,$,$,$,$,#4);
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCAXIS2PLACEMENT3D(#10,$,$);
#12=IFCLOCALPLACEMENT($,#11);
#15=IFCDIRECTION((0.,0.,1.));
#30=IFCCARTESIANPOINT((200.,-200.));
#31=IFCCARTESIANPOINT((4800.,-200.));
#32=IFCCARTESIANPOINT((5000.,0.));
#33=IFCCARTESIANPOINT((0.,0.));
#34=IFCPOLYLINE((#30,#31,#32,#33,#30));
#35=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#34);
#36=IFCEXTRUDEDAREASOLID(#35,#11,#15,3000.);
#37=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#36));
#38=IFCPRODUCTDEFINITIONSHAPE($,$,(#37));
#39=IFCWALL('w',$,'Mur onglet',$,$,#12,#38,$,$);
#40=IFCCARTESIANPOINT((2000.,-500.,900.));
#41=IFCAXIS2PLACEMENT3D(#40,$,$);
#42=IFCLOCALPLACEMENT($,#41);
#43=IFCCARTESIANPOINT((500.,500.));
#44=IFCAXIS2PLACEMENT2D(#43,$);
#45=IFCRECTANGLEPROFILEDEF(.AREA.,$,#44,1000.,1000.);
#46=IFCEXTRUDEDAREASOLID(#45,#11,#15,1200.);
#47=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#46));
#48=IFCPRODUCTDEFINITIONSHAPE($,$,(#47));
#49=IFCOPENINGELEMENT('o',$,$,$,$,#42,#48,$,$);
#50=IFCRELVOIDSELEMENT('v',$,$,$,#39,#49);
#60=IFCCARTESIANPOINTLIST2D(((0.,0.),(1000.,0.),(1000.,500.),(500.,1000.),(0.,500.)));
#61=IFCINDEXEDPOLYCURVE(#60,(IFCLINEINDEX((1,2,3)),IFCARCINDEX((3,4,5)),IFCLINEINDEX((5,1))),.F.);
#62=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#61);
#63=IFCCARTESIANPOINT((0.,3000.,0.));
#64=IFCAXIS2PLACEMENT3D(#63,$,$);
#65=IFCEXTRUDEDAREASOLID(#62,#64,#15,100.);
#66=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#65));
#67=IFCPRODUCTDEFINITIONSHAPE($,$,(#66));
#68=IFCPLATE('a',$,'Plaque arrondie',$,$,#12,#67,$,$);
#70=IFCCARTESIANPOINT((0.,6000.,0.));
#71=IFCAXIS2PLACEMENT3D(#70,$,$);
#72=IFCAXIS2PLACEMENT2D(#10,$);
#73=IFCRECTANGLEPROFILEDEF(.AREA.,$,#72,2000.,200.);
#74=IFCEXTRUDEDAREASOLID(#73,#71,#15,3000.);
#75=IFCCARTESIANPOINT((0.,0.,2000.));
#76=IFCDIRECTION((0.5,0.,0.866025403784));
#77=IFCAXIS2PLACEMENT3D(#75,#76,$);
#78=IFCPLANE(#77);
#79=IFCHALFSPACESOLID(#78,.F.);
#80=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#74,#79);
#81=IFCSHAPEREPRESENTATION($,'Body','Clipping',(#80));
#82=IFCPRODUCTDEFINITIONSHAPE($,$,(#81));
#83=IFCWALL('g',$,'Mur pignon',$,$,#12,#82,$,$);
ENDSEC;END-ISO-10303-21;`;

test("fichier facon Revit : unite de l'IFCUNITASSIGNMENT (mm), pas la derniere declaree", () => {
  const m = IFC.build(VRAI);
  const w = m.produits.find((p) => p.nom === "Mur onglet");
  assert.ok(Math.abs(w.bb.max[0] - 5) < 1e-6 && Math.abs(w.bb.max[2] - 3) < 1e-6, JSON.stringify(w.bb));
});

test("mur en onglet (trapeze) : l'ouverture est decoupee et la surface nette calculee", () => {
  const m = IFC.build(VRAI);
  const w = m.produits.find((p) => p.nom === "Mur onglet");
  assert.ok(!m.avertissements.some((a) => /Ouvertures/.test(a)), m.avertissements.join(" | "));
  assert.equal(w.surf.trous, 1);
  assert.ok(Math.abs(w.surf.nette - (w.surf.brute - 1.2)) < 0.02, `${w.surf.brute} ${w.surf.nette}`);
  // le solide perce reste ferme : il s'exporte en un vrai solide STEP
  const r = IFC.step(m, [m.produits.indexOf(w)]);
  assert.equal(r.nbSolides, 1); assert.equal(r.nbSurfaces, 0);
});

test("profil a arc (IFCINDEXEDPOLYCURVE) dessine, sans avertissement", () => {
  const m = IFC.build(VRAI);
  const p = m.produits.find((x) => x.nom === "Plaque arrondie");
  assert.ok(p && IFC.trisDe(p.morceaux[0]).length > 10);
  assert.ok(!m.avertissements.some((a) => /non dessin/.test(a)), m.avertissements.join(" | "));
  // l'arc passe par (500, 1000) : le haut de la plaque est a 1 m
  assert.ok(Math.abs(p.bb.max[1] - 4) < 1e-6, JSON.stringify(p.bb));
});

test("mur coupe par un plan (pignon) : la partie au-dessus du plan est retiree et rebouchee", () => {
  const m = IFC.build(VRAI);
  const g = m.produits.find((x) => x.nom === "Mur pignon");
  // plan incline passant par z = 2 m en x = 0 : le haut du mur descend sous 3 m d'un cote
  assert.ok(g.bb.max[2] < 3 - 1e-3 && g.bb.max[2] > 2, JSON.stringify(g.bb));
  const r = IFC.step(m, [m.produits.indexOf(g)]);
  assert.equal(r.nbSolides, 1, "rebouche : solide ferme");
});

test("enveloppe convexe 3D d'un cube", () => {
  const P = []; for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) P.push([x, y, z]);
  P.push([0.5, 0.5, 0.5]);
  assert.equal(IFC.enveloppe3D(P).length, 12);
});

// Petite archive ZIP (une entree compressee) fabriquee a la main
import { deflateRawSync } from "node:zlib";
function zipUn(nom, contenu) {
  const data = Buffer.from(contenu), comp = deflateRawSync(data), n = Buffer.from(nom);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const off = 30 + n.length + comp.length;
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + n.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([loc, n, comp, cen, n, fin]);
}

test(".ifczip : le .ifc de l'archive est decompresse et lu", async () => {
  const txt = readFileSync(new URL("../exemples/TinyHouse.ifc", import.meta.url), "utf8");
  const t = await IFC.texteIFC(new Blob([zipUn("maquette.ifc", txt)]));
  assert.equal(t.length, txt.length);
  assert.equal(IFC.build(t).produits.length, 71);
  // un .ifc normal passe tel quel
  assert.equal((await IFC.texteIFC(new Blob([txt]))).length, txt.length);
  await assert.rejects(IFC.texteIFC(new Blob([zipUn("lisezmoi.txt", "x")])), /aucun fichier \.ifc/);
});

test("geometrie compacte : simple precision relative, sans perte au 1/100 mm loin de l'origine", () => {
  const ifc = VRAI.replace("#10=IFCCARTESIANPOINT((0.,0.,0.));", "#10=IFCCARTESIANPOINT((2600000000.,1200000000.,0.));");
  const m = IFC.build(ifc);
  const w = m.produits.find((p) => p.nom === "Mur onglet");
  assert.ok(w.morceaux[0].T instanceof Float32Array);
  const xs = IFC.trisDe(w.morceaux[0]).flat().map((p) => p[0]);
  // coordonnees suisses (2 600 000 m) : la longueur du mur reste exacte
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 5) < 1e-5, String(Math.max(...xs) - Math.min(...xs)));
});

test("facades : mur exterieur et ouvertures de chaque face, metre", () => {
  const F = IFC.facades(M, 0);
  assert.deepEqual(F.a.murs.map((i) => M.produits[i].nom), ["Wall_Left"]);
  assert.deepEqual(F.c.murs.map((i) => M.produits[i].nom), ["Wall_Right"]);
  assert.equal(F.a.ouvertures.length, 4);
  assert.ok(Math.abs(F.a.metre.brute - 33.6) < 1e-6);
  assert.equal(F.a.metre.fenetres + F.a.metre.portes, 4);
  const o = F.a.ouvertures.find((x) => x.nom === "Win_Living_L");
  assert.equal(o.largeur, 2400); assert.equal(o.allege, 800);
  // tableaux = 2 x hauteur par ouverture
  assert.ok(Math.abs(F.a.metre.tableaux - F.a.ouvertures.reduce((s, x) => s + (2 * x.hauteur) / 1000, 0)) < 1e-9);
  // pas de mur compte sur deux faces
  const vus = Object.values(F).flatMap((f) => f.murs); assert.equal(new Set(vus).size, vus.length);
});

test("elevation cotee : traits, cotes, dimensions des ouvertures et niveaux dans le DXF", () => {
  const F = IFC.facades(M, 0), e = IFC.elevation(M, F.a);
  assert.ok(e.segs.some((s) => s.calque === "MUR") && e.segs.some((s) => s.calque === "COTES") && e.segs.some((s) => s.calque === "NIVEAUX"));
  assert.ok(e.textes.some((t) => t.txt === "2400 x 1500") && e.textes.some((t) => t.txt === "all. 800"));
  assert.ok(e.textes.some((t) => t.txt === "10500"), "cote totale de la facade");
  const d = IFC.dxf(e.segs, "Face A", e.textes);
  assert.match(d, /IFC-COTES/); assert.match(d, /\r\n72\r\n1\r\n/); assert.match(d, /EOF\r\n$/);
  // sans cotes : seulement les traits
  assert.ok(!IFC.elevation(M, F.a, false).segs.some((s) => s.calque === "COTES"));
});

test("batiment tourne : orientation detectee, memes facades", () => {
  const R = IFC.build(readFileSync(new URL("../exemples/TinyHouse.ifc", import.meta.url), "utf8"));
  const t = (30 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  for (const p of R.produits) {
    for (const m of p.morceaux) { const o = m.o; for (const A of [m.T, m.A]) for (let i = 0; i < A.length; i += 3) { const x = A[i] + o[0], y = A[i + 1] + o[1]; A[i] = c * x - s * y - o[0]; A[i + 1] = s * x + c * y - o[1]; } }
    const P = p.morceaux.flatMap((m) => IFC.trisDe(m).flat()); p.bb = IFC.bbox(P);
  }
  R.bbTout = IFC.bbox(R.produits.flatMap((p) => [p.bb.min, p.bb.max]));
  const a = (IFC.orientation(R) * 180) / Math.PI;
  assert.ok(Math.abs(a - 30) <= 1.5, String(a));
  const F = IFC.facades(R);
  assert.deepEqual(F.a.murs.map((i) => R.produits[i].nom), ["Wall_Left"]);
  assert.equal(F.a.ouvertures.length, 4);
  assert.ok(Math.abs(F.a.metre.longueur - 10.5) < 0.01, String(F.a.metre.longueur));
});

test("element ignore (calcul bloquant) : saute, signale, le reste se lit", () => {
  const m = IFC.build(VRAI, null, { ignorer: [49] });
  const w = m.produits.find((p) => p.nom === "Mur onglet");
  assert.equal(w.surf ? w.surf.trous : 0, 0);
  assert.ok(m.avertissements.some((a) => /ignoré.*#49/.test(a)), m.avertissements.join(" | "));
  assert.equal(m.produits.length, IFC.build(VRAI).produits.length);
});

test("arc tronque avec un angle enorme : pas de boucle sans fin", () => {
  const ifc = VRAI.replace("ENDSEC;END-ISO-10303-21;", `#90=IFCAXIS2PLACEMENT2D(#10,$);
#91=IFCCIRCLE(#90,500.);
#92=IFCTRIMMEDCURVE(#91,(IFCPARAMETERVALUE(1.E20)),(IFCPARAMETERVALUE(3.)),.T.,.PARAMETER.);
#93=IFCCARTESIANPOINT((0.,0.));
#94=IFCPOLYLINE((#93,#93));
#95=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#92);
#96=IFCCOMPOSITECURVE((#95),.F.);
#97=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#96);
#98=IFCEXTRUDEDAREASOLID(#97,#11,#15,100.);
#99=IFCSHAPEREPRESENTATION($,'Body','SweptSolid',(#98));
#100=IFCPRODUCTDEFINITIONSHAPE($,$,(#99));
#101=IFCOPENINGELEMENT('z',$,$,$,$,#12,#100,$,$);
#102=IFCREVOLVEDAREASOLID(#45,#11,#103,360.);
#103=IFCAXIS1PLACEMENT(#10,$);
ENDSEC;END-ISO-10303-21;`);
  const t0 = Date.now(); const m = IFC.build(ifc);
  assert.ok(Date.now() - t0 < 3000); assert.ok(m.produits.length >= 3);
});

// ---------- Fichiers STEP (resultat d'OpenCascade -> modele) ----------
// cube de cote a (mm) tel qu'OpenCascade le rend : 6 faces B-rep, chacune avec ses 4 sommets et 2 triangles
function cubeOCC(a, couleurFace = {}, couleur = null, nom = "SOLID") {
  const C = [[[0, 0, a], [a, 0, a], [a, a, a], [0, a, a]], [[0, 0, 0], [0, a, 0], [a, a, 0], [a, 0, 0]], [[0, 0, 0], [a, 0, 0], [a, 0, a], [0, 0, a]], [[0, a, 0], [0, a, a], [a, a, a], [a, a, 0]], [[0, 0, 0], [0, 0, a], [0, a, a], [0, a, 0]], [[a, 0, 0], [a, a, 0], [a, a, a], [a, 0, a]]];
  const pos = [], idx = [], faces = [];
  C.forEach((q, f) => { q.forEach((p) => pos.push(...p)); idx.push(4 * f, 4 * f + 1, 4 * f + 2, 4 * f, 4 * f + 2, 4 * f + 3); faces.push([2 * f, 2 * f + 1, couleurFace[f] || null]); });
  return { nom, couleur, pos: Float64Array.from(pos), idx: Uint32Array.from(idx), faces };
}
const noeud = (nom, meshes = [], enfants = []) => ({ nom, meshes, enfants });

test("STEP : un cube de 100 mm donne 0,1 m, volume 1 000 cm3, surface 600 cm2, 12 aretes", () => {
  const S = IFC.depuisStep({ meshes: [cubeOCC(100)], racine: noeud("", [0]) }, { nom: "cube.stp" });
  assert.equal(S.source, "step"); assert.equal(S.schema, "STEP"); assert.equal(S.projet, "cube");
  assert.equal(S.produits.length, 1);
  const p = S.produits[0];
  assert.deepEqual(p.bb.min.map((v) => +v.toFixed(6)), [0, 0, 0]); assert.deepEqual(p.bb.max.map((v) => +v.toFixed(6)), [0.1, 0.1, 0.1]);
  assert.ok(Math.abs(p.geo.volume - 1e-3) < 1e-9); assert.ok(Math.abs(p.geo.surface - 0.06) < 1e-9); assert.equal(p.geo.ferme, true); assert.equal(p.geo.faces, 6);
  assert.equal(p.morceaux.reduce((n, m) => n + m.T.length / 9, 0), 12);
  assert.equal(p.morceaux.reduce((n, m) => n + m.A.length / 6, 0), 12, "les 12 aretes du cube, pas les diagonales des faces");
  assert.match(p.psets[0].props.find((x) => x.nom === "Volume").val, /^1\D?000 cm³$/);
});

test("STEP : couleurs par forme et par face, un morceau par couleur", () => {
  const S = IFC.depuisStep({ meshes: [cubeOCC(50, { 0: [1, 0, 0] }, [0, 0, 1])], racine: noeud("", [0]) });
  const m = S.produits[0].morceaux, rgb = m.map((x) => x.couleur.rgb.map((v) => Math.round(v * 255)).join(","));
  assert.deepEqual(rgb.sort(), ["0,0,255", "255,0,0"]);
  assert.equal(m.find((x) => x.couleur.rgb[0] === 1).T.length / 9, 2, "la face rouge = 2 triangles");
  const defaut = IFC.depuisStep({ meshes: [cubeOCC(50)], racine: noeud("", [0]) });
  assert.ok(defaut.produits[0].morceaux[0].couleur.rgb.every((v) => v > 0.5 && v < 0.8), "gris neutre sans couleur dans le fichier");
});

test("STEP : sous-ensembles d'apres l'arbre, noms de pieces, deux instances homonymes separees", () => {
  const racine = noeud("Open CASCADE STEP", [], [noeud("ASM", [], [noeud("PLATE", [0]), noeud("BRACKET", [1, 2]), noeud("BRACKET", [3, 4])])]);
  const S = IFC.depuisStep({ meshes: [0, 1, 2, 3, 4].map(() => cubeOCC(10)), racine });
  assert.deepEqual(S.etages.map((e) => e.nom), ["ASM", "ASM › BRACKET", "ASM › BRACKET (2)"]);
  assert.ok(S.etages.every((e) => e.groupe && e.elev === 0 && e.z === 0));
  assert.deepEqual(S.produits.map((p) => p.nom), ["PLATE", "BRACKET · 1", "BRACKET · 2", "BRACKET · 1", "BRACKET · 2"]);
  assert.deepEqual(S.produits.map((p) => p.etage), [1, 2, 2, 3, 3]);
  const seul = IFC.depuisStep({ meshes: [cubeOCC(10, {}, null, "SOLID")], racine: noeud("", [0]) });
  assert.deepEqual(seul.produits.map((p) => p.nom), ["Pièce"]); assert.deepEqual(seul.etages.map((e) => e.nom), ["Pièces"]);
});

test("STEP : surface cylindrique tangente a un plan : pas de trait sur les facettes ni sur le raccord", () => {
  // bande de 8 facettes (rayon 10 mm, 1/4 de tour, finit verticale) prolongee tangentiellement par un plan vertical : une face B-rep courbe + une plane
  const pos = [], idx = [], faces = [];
  const R = 10, n = 8; let v = 0;
  for (let i = 0; i <= n; i++) { const t = (i / n) * (Math.PI / 2); pos.push(R * Math.sin(t), 0, R - R * Math.cos(t), R * Math.sin(t), 20, R - R * Math.cos(t)); }
  for (let i = 0; i < n; i++) { const a = 2 * i, b = 2 * i + 1, c = 2 * i + 2, d = 2 * i + 3; idx.push(a, c, b, b, c, d); }
  faces.push([0, 2 * n - 1, null]); v = pos.length / 3;
  pos.push(R, 0, R, R, 20, R, R, 0, R + 30, R, 20, R + 30); idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); faces.push([2 * n, 2 * n + 1, null]);
  const S = IFC.depuisStep({ meshes: [{ nom: "", couleur: null, pos: Float64Array.from(pos), idx: Uint32Array.from(idx), faces }], racine: noeud("", [0]) });
  const m = S.produits[0].morceaux[0], A = m.A, o = m.o;
  // seuls les bords ouverts sont traces (les 2 bords longs et les 2 bouts) ; aucun trait en travers de la bande (facettes, raccord tangent)
  let enTravers = 0, bouts = 0, longs = 0;
  for (let i = 0; i < A.length; i += 6) {
    const za = A[i + 2] + o[2], zb = A[i + 5] + o[2], dy = Math.abs(A[i + 1] - A[i + 4]);
    if (dy > 0.01) { if (Math.min(za, zb) > 1e-5 && Math.max(za, zb) < 0.0399) enTravers++; else bouts++; } else longs++;
  }
  assert.equal(enTravers, 0, "pas de trait sur les 7 joints de facettes ni sur le raccord plan / cylindre");
  assert.equal(bouts, 2); assert.equal(longs, 2 * (8 + 1), "8 facettes + 1 plan sur chacun des 2 bords longs");
  assert.equal(S.produits[0].geo.ferme, false, "forme ouverte : pas de volume");
  assert.equal(S.produits[0].psets[0].props.some((x) => x.nom === "Volume"), false);
});

test("STEP : lecture reelle avec OpenCascade (aller-retour avec l'export de Maquette)", async () => {
  const { createRequire } = await import("node:module");
  const occt = await createRequire(import.meta.url)("../vendor/occt/occt-import-js.js")();
  const out = IFC.step(M, M.produits.map((_, i) => i), { fichier: "t.stp", nom: "TinyHouse" });
  const r = occt.ReadStepFile(new Uint8Array(Buffer.from(out.texte)), { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.2 });
  assert.equal(r.success, true);
  const nd = (n) => ({ nom: n.name || "", meshes: Array.from(n.meshes || []), enfants: (n.children || []).map(nd) });
  const res = { meshes: r.meshes.map((m) => ({ nom: m.name || "", couleur: m.color ? Array.from(m.color) : null, pos: Float64Array.from(m.attributes.position.array), idx: Uint32Array.from(m.index.array), faces: (m.brep_faces || []).map((f) => [f.first, f.last, f.color ? Array.from(f.color) : null]) })), racine: nd(r.root) };
  const S = IFC.depuisStep(res, { nom: "t.stp" });
  assert.ok(S.produits.length >= out.nbSolides && S.produits.length <= out.nbSolides + 3, `au moins une piece par solide exporte (${S.produits.length} pour ${out.nbSolides})`);
  const f = (b) => [b.min, b.max].map((a) => a.map((v) => +v.toFixed(3)));
  assert.deepEqual(f(S.bbTout), f(M.bbTout), "memes dimensions au mm pres que la maquette IFC d'origine");
  assert.ok(S.produits.every((p) => p.geo.ferme && p.geo.volume > 0), "tous les solides exportes sont fermes");
  const mur = S.produits.find((p) => p.nom === "Wall_Left");
  assert.deepEqual(f(mur.bb), f(parNom("Wall_Left").bb));
});

// ---------- Vues 2D d'un STEP -> DXF (1.12) ----------
function cylindreOCC(R, L, N = 48) { // axe Y, de y = 0 a y = L ; 3 faces : flanc, fond y = 0, fond y = L
  const pos = [], idx = [];
  for (let k = 0; k < N; k++) { const a = (2 * Math.PI * k) / N; pos.push(R * Math.cos(a), 0, R * Math.sin(a)); }
  for (let k = 0; k < N; k++) { const a = (2 * Math.PI * k) / N; pos.push(R * Math.cos(a), L, R * Math.sin(a)); }
  pos.push(0, 0, 0, 0, L, 0); const c0 = 2 * N, c1 = 2 * N + 1;
  for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; idx.push(k, k2, N + k2, k, N + k2, N + k); }
  for (let k = 0; k < N; k++) idx.push(c0, (k + 1) % N, k);
  for (let k = 0; k < N; k++) idx.push(c1, N + k, N + ((k + 1) % N));
  return { nom: "Axe", couleur: null, pos: Float64Array.from(pos), idx: Uint32Array.from(idx), faces: [[0, 2 * N - 1, null], [2 * N, 3 * N - 1, null], [3 * N, 4 * N - 1, null]] };
}
test("Vue 2D d'un cube de 100 mm : 4 traits visibles, rien de cache, deux cotes de 100", () => {
  const S = IFC.depuisStep({ meshes: [cubeOCC(100)], racine: noeud("", [0]) });
  const P = IFC.projection(S, [0], "a");
  assert.equal(P.nom, "Avant");
  assert.equal(P.segs.filter((s) => s.calque === "VISIBLE").length, 4, "le carre vu de face (les aretes de derriere, identiques, ne comptent pas)");
  assert.equal(P.segs.filter((s) => s.calque === "CACHE").length, 0);
  assert.equal(P.textes.filter((t) => t.txt === "100").length, 2, "largeur et hauteur");
  assert.ok(Math.abs(P.largeur - 0.1) < 1e-6 && Math.abs(P.hauteur - 0.1) < 1e-6);
});
test("Vue 2D : un cylindre vu dans l'axe donne un vrai cercle avec son diametre, de cote un rectangle", () => {
  const S = IFC.depuisStep({ meshes: [cylindreOCC(25, 40)], racine: noeud("", [0]) });
  const face = IFC.projection(S, [0], "a");
  assert.ok(face.cercles.length >= 1, "cercle detecte");
  const c = face.cercles.find((x) => x.calque === "VISIBLE"); assert.ok(c && Math.abs(c.r - 0.025) < 5e-5, `rayon ${c && c.r}`);
  assert.ok(face.textes.some((t) => /^Ø50/.test(t.txt)), "diametre note Ø50");
  assert.ok(face.segs.some((s) => s.calque === "AXES"), "axes du trou");
  const cote = IFC.projection(S, [0], "dessus");
  assert.equal(cote.cercles.length, 0);
  assert.ok(Math.abs(cote.largeur - 0.05) < 1e-4 && Math.abs(cote.hauteur - 0.04) < 1e-4, `${cote.largeur} x ${cote.hauteur}`);
  const sans = IFC.projection(S, [0], "a", { trous: false });
  assert.ok(!sans.textes.some((t) => /^Ø/.test(t.txt)), "option sans trous");
});
test("DXF d'une vue : cercles, calques STEP-, tirets et mention a controler", () => {
  const S = IFC.depuisStep({ meshes: [cylindreOCC(25, 40)], racine: noeud("", [0]) });
  const P = IFC.projection(S, [0], "a", { entraxes: true });
  const d = IFC.dxf(P.segs, "x - COTES CALCULEES PAR MAQUETTE : A CONTROLER", P.textes, { prefixe: "STEP", calques: IFC.CALQUES_VUE, cercles: P.cercles, arcs: P.arcs, hTitre: P.titre.h, dyTitre: P.titre.dy, ltscale: P.ltscale });
  assert.match(d, /\nCIRCLE\r/); assert.match(d, /STEP-VISIBLE/); assert.match(d, /DASHED/); assert.match(d, /A CONTROLER/); assert.match(d, /%%c50/, "Ø devient %%c pour AutoCAD");
  assert.ok(!/\nNaN|undefined/.test(d));
});
test("Vue 2D : les six vues d'une piece ont les bonnes dimensions (X, Y, Z differents)", () => {
  const m = cubeOCC(100); for (let i = 0; i < m.pos.length; i += 3) { m.pos[i] *= 3; m.pos[i + 2] *= 2; } // 300 (X) x 100 (Y) x 200 (Z)
  const S = IFC.depuisStep({ meshes: [m], racine: noeud("", [0]) });
  const d = (k) => { const P = IFC.projection(S, [0], k); return [Math.round(P.largeur * 1000), Math.round(P.hauteur * 1000)]; };
  assert.deepEqual(d("dessus"), [300, 100]); assert.deepEqual(d("dessous"), [300, 100]);
  assert.deepEqual(d("a"), [300, 200]); assert.deepEqual(d("c"), [300, 200]);
  assert.deepEqual(d("b"), [100, 200]); assert.deepEqual(d("d"), [100, 200]);
  assert.throws(() => IFC.projection(S, [0], "haut"), /vue inconnue/);
});

// ---------- Comparaison de deux versions (1.13) ----------
test("Comparaison : une maquette comparee a elle-meme est entierement identique", () => {
  const R = IFC.comparer(M, M);
  assert.equal(R.cle, "gid"); assert.equal(R.ajoutes.length, 0); assert.equal(R.supprimes.length, 0);
  assert.equal(R.compte.identique, M.produits.length); assert.equal(R.compte.modifie + R.compte.deplace, 0);
});
test("Comparaison IFC par GlobalId : ajout, suppression, deplacement, modification de dimension, de materiau et de propriete", () => {
  const prod = M.produits, [pSup, pDep, pDim, pMat, pPro] = [prod[0], prod[1], prod[2], prod[3], prod[4]];
  const decale = (p, d) => ({ ...p, bb: { min: p.bb.min.map((v, k) => v + d[k]), max: p.bb.max.map((v, k) => v + d[k]) } });
  const nouveaux = prod.map((p) => p === pSup ? null : p === pDep ? decale(p, [0.5, 0, 0]) : p === pDim ? { ...p, bb: { min: p.bb.min, max: [p.bb.max[0] + 0.1, p.bb.max[1], p.bb.max[2]] } } : p === pMat ? { ...p, materiau: "Autre matériau" } : p === pPro ? { ...p, psets: [{ nom: "Pset_X", props: [{ nom: "Feu", val: "EI30" }] }] } : p).filter(Boolean);
  nouveaux.push({ ...prod[5], gid: "NOUVEAU-GID-0000000000", nom: "Nouveau", id: 99999 });
  const B = { ...M, produits: nouveaux };
  const R = IFC.comparer(M, B), par = (p) => R.paires.find((x) => M.produits[x.a] === p);
  assert.deepEqual(R.supprimes, [0]); assert.equal(R.ajoutes.length, 1); assert.equal(B.produits[R.ajoutes[0]].nom, "Nouveau");
  assert.equal(par(pDep).statut, "deplace"); assert.ok(Math.abs(par(pDep).delta[0] - 0.5) < 1e-9); assert.match(par(pDep).details[0], /Déplacé de 500 mm/);
  assert.equal(par(pDim).statut, "modifie"); assert.match(par(pDim).details.join("|"), /Dimensions : X .* → .* mm/);
  assert.equal(par(pMat).statut, "modifie"); assert.match(par(pMat).details.join("|"), /Matériau : .* → Autre matériau/);
  assert.equal(par(pPro).statut, "modifie"); assert.match(par(pPro).details.join("|"), /Propriété Pset_X\.Feu : — → EI30/);
  assert.equal(R.compte.deplace, 1); assert.equal(R.compte.modifie >= 3, true);
});
test("Comparaison STEP : pieces appariees par nom, renommee reconnue par sa forme, ajout et suppression", () => {
  const cube = (nom, a, dx = 0) => { const c = cubeOCC(a); c.nom = nom; for (let i = 0; i < c.pos.length; i += 3) c.pos[i] += dx; return c; };
  const mk = (L) => IFC.depuisStep({ meshes: L, racine: noeud("", L.map((_, i) => i)) });
  const A = mk([cube("Plaque", 100), cube("Equerre", 50, 300), cube("Vis", 20, 600), cube("Rondelle", 30, 900)]);
  const B = mk([cube("Plaque", 100, 5), cube("Equerre-v2", 50, 300), cube("Vis", 25, 600), cube("Ecrou", 40, 1200)]);
  const R = IFC.comparer(A, B), nom = (x) => `${A.produits[x.a].nom}>${B.produits[x.b].nom}`;
  const st = Object.fromEntries(R.paires.map((x) => [nom(x), x.statut]));
  assert.equal(st["Plaque · 1>Plaque · 1"], "deplace"); assert.equal(st["Equerre · 2>Equerre-v2 · 2"], "modifie", "renommee : le nom change");
  assert.equal(st["Vis · 3>Vis · 3"], "modifie");
  assert.deepEqual(R.supprimes.map((i) => A.produits[i].nom), ["Rondelle · 4"]); assert.deepEqual(R.ajoutes.map((j) => B.produits[j].nom), ["Ecrou · 4"]);
});
test("Comparaison : le modele fusionne garde la nouvelle version et ajoute les pieces supprimees", () => {
  const prod = M.produits, B = { ...M, produits: prod.slice(1) };
  const R = IFC.comparer(M, B), C = IFC.fusionComparaison(M, B, R);
  assert.equal(C.produits.length, prod.length); assert.equal(C.produits.filter((p) => p.cmp === "supprime").length, 1);
  assert.equal(C.produits.filter((p) => p.cmp === "identique").length, prod.length - 1);
  const sup = C.produits.find((p) => p.cmp === "supprime"); assert.equal(sup.nom, prod[0].nom); assert.ok(new Set(C.produits.map((p) => p.id)).size === C.produits.length, "identifiants uniques");
  assert.equal(C.comparaison.compte.supprime, 1);
});

// ---------- Orientation d'un STEP (1.14) ----------
const dimsM = (S) => S.bbTout.max.map((v, k) => Math.round((v - S.bbTout.min[k]) * 1000));
function etage3() { const m = cubeOCC(100); for (let i = 0; i < m.pos.length; i += 3) { m.pos[i] *= 3; m.pos[i + 2] *= 2; } return IFC.depuisStep({ meshes: [m], racine: noeud("", [0]) }); } // 300 x 100 x 200
test("Orientation : 90 degres autour de X echange Y et Z, puis l'annulation rend l'original", () => {
  const S = etage3(), avant = JSON.stringify(S.produits[0].bb);
  assert.deepEqual(dimsM(S), [300, 100, 200]);
  IFC.pivoter(S, IFC.matriceAxe("x", 90)); assert.deepEqual(dimsM(S), [300, 200, 100]);
  IFC.pivoter(S, IFC.matriceAxe("z", 90)); assert.deepEqual(dimsM(S), [200, 300, 100]);
  assert.equal(IFC.estIdentite(S.rot), false);
  IFC.annulerPivot(S); assert.deepEqual(dimsM(S), [300, 100, 200]); assert.ok(IFC.estIdentite(S.rot));
  const b = S.produits[0].bb; assert.ok(b.min.every((v, k) => Math.abs(v - JSON.parse(avant).min[k]) < 1e-6) && b.max.every((v, k) => Math.abs(v - JSON.parse(avant).max[k]) < 1e-6), "memes coordonnees qu'au depart");
});
test("Orientation : poser sur une face amene cette face en dessous, et la vue de dessus suit", () => {
  const S = etage3();
  IFC.pivoter(S, IFC.matricePoser([1, 0, 0])); // la face +X (200 x 100) devient le dessous
  assert.deepEqual(dimsM(S), [200, 100, 300]);
  const P = IFC.projection(S, [0], "dessus"); assert.deepEqual([Math.round(P.largeur * 1000), Math.round(P.hauteur * 1000)], [200, 100]);
  const S2 = etage3(); IFC.pivoter(S2, IFC.matricePoser([0, 0, 1])); assert.deepEqual(dimsM(S2), [300, 100, 200]); // dessus -> dessous : retourne, memes dimensions
  const S3 = etage3(); IFC.pivoter(S3, IFC.matricePoser([0.6, 0, 0.8])); // face inclinee : la rotation reste une vraie rotation
  const R = S3.rot, det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  assert.ok(Math.abs(det - 1) < 1e-9); const n = [R[0][0] * 0.6 + R[0][2] * 0.8, R[1][0] * 0.6 + R[1][2] * 0.8, R[2][0] * 0.6 + R[2][2] * 0.8]; assert.ok(Math.abs(n[2] + 1) < 1e-9, "la normale pointe vers le bas");
});
test("Orientation : angle libre, volume et surface inchanges", () => {
  const S = etage3(), v0 = S.produits[0].geo.volume; IFC.pivoter(S, IFC.matriceAxe("z", 30));
  const d = dimsM(S); assert.ok(d[0] > 300 && d[1] > 100 && d[2] === 200, d.join());
  const aire = (p) => p.morceaux.reduce((a, m) => { let s2 = 0; for (let i = 0; i < m.T.length; i += 9) { const u = [m.T[i + 3] - m.T[i], m.T[i + 4] - m.T[i + 1], m.T[i + 5] - m.T[i + 2]], w = [m.T[i + 6] - m.T[i], m.T[i + 7] - m.T[i + 1], m.T[i + 8] - m.T[i + 2]]; s2 += 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]); } return a + s2; }, 0);
  assert.ok(Math.abs(aire(S.produits[0]) - S.produits[0].geo.surface) < 1e-5, "surface conservee"); assert.equal(S.produits[0].geo.volume, v0);
});
