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
