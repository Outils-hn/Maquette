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
