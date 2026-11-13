// Maquette - moteur IFC : lecture du fichier (format STEP), geometrie, donnees, coupes et DXF.
// Tout se passe dans le navigateur : le fichier n'est jamais envoye. Teste par tests/core.test.js.
const IFC = (() => {
  // ---------- Lecture STEP ----------
  function decodeStr(s) {
    return s.replace(/''/g, "'")
      .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_m, h) => h.match(/.{4}/g).map((c) => String.fromCharCode(parseInt(c, 16))).join(""))
      .replace(/\\X\\([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\S\\(.)/g, (_m, c) => String.fromCharCode(c.charCodeAt(0) + 128));
  }
  function parseArgs(src, i) {
    // src[i] === "(" ; renvoie [liste, indexApres]
    const out = []; i++;
    while (i < src.length) {
      const c = src[i];
      if (c === ")") return [out, i + 1];
      if (c === "," || c === " " || c === "\n" || c === "\r" || c === "\t") { i++; continue; }
      if (c === "(") { const [l, j] = parseArgs(src, i); out.push(l); i = j; continue; }
      if (c === "'") {
        let j = i + 1, s = "";
        while (j < src.length) { if (src[j] === "'") { if (src[j + 1] === "'") { s += "''"; j += 2; continue; } break; } s += src[j++]; }
        out.push({ s: decodeStr(s) }); i = j + 1; continue;
      }
      if (c === "#") { let j = i + 1; while (/[0-9]/.test(src[j])) j++; out.push({ r: +src.slice(i + 1, j) }); i = j; continue; }
      if (c === "$" || c === "*") { out.push(null); i++; continue; }
      if (c === ".") { const j = src.indexOf(".", i + 1); out.push({ e: src.slice(i + 1, j) }); i = j + 1; continue; }
      if (/[A-Z]/i.test(c)) { // valeur typee IFCLABEL('x')
        let j = i; while (/[A-Z0-9_]/i.test(src[j])) j++;
        const t = src.slice(i, j).toUpperCase();
        if (src[j] === "(") { const [l, k] = parseArgs(src, j); out.push({ t, v: l[0] }); i = k; } else { out.push({ e: t }); i = j; }
        continue;
      }
      let j = i; while (j < src.length && !/[,)]/.test(src[j])) j++;
      out.push(parseFloat(src.slice(i, j))); i = j;
    }
    return [out, i];
  }
  function parse(text) {
    const ents = new Map();
    const d = text.indexOf("DATA;");
    const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/gi;
    re.lastIndex = d < 0 ? 0 : d;
    let m;
    while ((m = re.exec(text))) {
      const [args, end] = parseArgs(text, re.lastIndex - 1);
      ents.set(+m[1], { id: +m[1], type: m[2].toUpperCase(), a: args });
      re.lastIndex = end;
    }
    const schema = (text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || "?";
    return { ents, schema };
  }

  // ---------- Petits outils de calcul ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // colonnes
  function mul(A, B) { const C = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k]; C[c * 4 + r] = s; } return C; }
  const tp = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
  const td = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2], M[1] * p[0] + M[5] * p[1] + M[9] * p[2], M[2] * p[0] + M[6] * p[1] + M[10] * p[2]];
  const frame = (x, y, z, o) => [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];

  // ---------- Polygones 2D ----------
  const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  function hull(pts) {
    const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up); // sens trigonometrique
  }
  // Decoupe d'un polygone convexe par le demi-plan « a gauche de l'arete a->b » (garde = true) ou a droite (garde = false)
  function clipHalf(P, a, b, gauche) {
    const s = (q) => { const v = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]); return gauche ? v : -v; };
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], sp = s(p), sq = s(q);
      if (sp >= -1e-12) out.push(p);
      if ((sp > 1e-12 && sq < -1e-12) || (sp < -1e-12 && sq > 1e-12)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    return out.length >= 3 && Math.abs(area2(out)) > 1e-9 ? out : null;
  }
  // A - B pour deux polygones convexes (sens trigo) : morceaux convexes disjoints
  function subtractConvex(A, B) {
    const pieces = []; let rest = A;
    for (let i = 0; i < B.length && rest; i++) {
      const a = B[i], b = B[(i + 1) % B.length];
      const dehors = clipHalf(rest, a, b, false); if (dehors) pieces.push(dehors);
      rest = clipHalf(rest, a, b, true);
    }
    return pieces;
  }
  const insideConvex = (P, q, eps = 1e-7) => { for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) <= eps) return false; } return true; };

  // Triangulation d'un polygone simple (oreilles), avec trous raccordes par un pont
  function triangulate(outer, holes = []) {
    let P = outer.slice(); if (area2(P) < 0) P.reverse();
    for (const h0 of holes.slice().sort((a, b) => Math.max(...b.map((q) => q[0])) - Math.max(...a.map((q) => q[0])))) {
      let h = h0.slice(); if (area2(h) > 0) h.reverse();
      let hi = 0; h.forEach((q, i) => { if (q[0] > h[hi][0]) hi = i; });
      const m = h[hi]; let best = -1, bd = Infinity;
      P.forEach((q, i) => { const d = (q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2; if (d < bd && !segCrosses(m, q, P, h)) { bd = d; best = i; } });
      if (best < 0) continue;
      const hr = h.slice(hi).concat(h.slice(0, hi + 1));
      P = P.slice(0, best + 1).concat(hr, [P[best]], P.slice(best + 1));
    }
    const idx = P.map((_, i) => i), tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let found = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        const a = P[i0], b = P[i1], c = P[i2];
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-14) continue;
        let ok = true;
        for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; const q = P[j]; if ((q[0] === a[0] && q[1] === a[1]) || (q[0] === b[0] && q[1] === b[1]) || (q[0] === c[0] && q[1] === c[1])) continue; if (insideConvex([a, b, c], q, 1e-12)) { ok = false; break; } }
        if (!ok) continue;
        tris.push([a, b, c]); idx.splice(k, 1); found = true; break;
      }
      if (!found) break;
    }
    if (idx.length === 3) tris.push(idx.map((i) => P[i]));
    return tris;
  }
  function segCrosses(p, q, A, B) {
    const inter = (a, b, c, d) => { const o = (u, v, w) => Math.sign((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
    for (const L of [A, B]) for (let i = 0; i < L.length; i++) if (inter(p, q, L[i], L[(i + 1) % L.length])) return true;
    return false;
  }
  // Polygone 3D plan -> triangles 3D (projection sur le plan dominant)
  function triangulate3D(outer, holes = []) {
    let n = [0, 0, 0];
    for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
    if (outer.length === 3 && !holes.length) return [outer];
    const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
    const [u, v] = ax === 0 ? [1, 2] : ax === 1 ? [2, 0] : [0, 1];
    const key = new Map(); const to2 = (p) => { const q = [p[u], p[v]]; key.set(q, p); return q; };
    const o2 = outer.map(to2), h2 = holes.map((h) => h.map(to2));
    return triangulate(o2, h2).map((t) => t.map((q) => key.get(q)));
  }

  // ---------- Construction du modele ----------
  const TYPES_FR = {
    IFCWALL: "Mur", IFCWALLSTANDARDCASE: "Mur", IFCCURTAINWALL: "Mur-rideau", IFCWINDOW: "Fenêtre", IFCDOOR: "Porte", IFCSLAB: "Dalle", IFCROOF: "Toiture",
    IFCSTAIR: "Escalier", IFCSTAIRFLIGHT: "Volée d'escalier", IFCRAMP: "Rampe", IFCRAILING: "Garde-corps", IFCCOLUMN: "Poteau", IFCBEAM: "Poutre", IFCMEMBER: "Profilé",
    IFCPLATE: "Panneau", IFCCOVERING: "Revêtement", IFCFOOTING: "Fondation", IFCBUILDINGELEMENTPROXY: "Élément divers", IFCFURNISHINGELEMENT: "Mobilier", IFCFURNITURE: "Mobilier",
    IFCSHADINGDEVICE: "Protection solaire", IFCCHIMNEY: "Cheminée", IFCFLOWTERMINAL: "Équipement", IFCSPACE: "Pièce",
  };
  const COULEURS = { IFCWALL: [0.92, 0.9, 0.86], IFCWALLSTANDARDCASE: [0.92, 0.9, 0.86], IFCSLAB: [0.7, 0.7, 0.68], IFCROOF: [0.35, 0.33, 0.32], IFCWINDOW: [0.55, 0.62, 0.68], IFCDOOR: [0.62, 0.48, 0.34], IFCSTAIR: [0.72, 0.55, 0.35], IFCBUILDINGELEMENTPROXY: [0.5, 0.52, 0.55], IFCCURTAINWALL: [0.6, 0.72, 0.8], IFCPLATE: [0.6, 0.75, 0.85], IFCMEMBER: [0.55, 0.57, 0.6] };
  const VERRE = [0.62, 0.8, 0.92];
  const PAS_DESSINES = new Set(["IFCOPENINGELEMENT", "IFCSPACE", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCANNOTATION", "IFCGRID", "IFCVIRTUALELEMENT", "IFCPROJECT"]);

  function build(text) {
    const { ents, schema } = parse(text);
    const E = (r) => (r && r.r != null ? ents.get(r.r) : null);
    const num = (v) => (v == null ? null : typeof v === "number" ? v : v.v != null ? v.v : null);
    const str = (v) => (v == null ? "" : v.s != null ? v.s : v.v && v.v.s != null ? v.v.s : v.e != null ? v.e : typeof v === "number" ? String(v) : "");
    const avertissements = new Set();

    // Unite de longueur
    let k = 1;
    for (const e of ents.values()) if (e.type === "IFCSIUNIT" && str(e.a[1]) === "LENGTHUNIT") { const p = str(e.a[2]); k = p === "MILLI" ? 0.001 : p === "CENTI" ? 0.01 : p === "DECI" ? 0.1 : 1; }
    for (const e of ents.values()) if (e.type === "IFCCONVERSIONBASEDUNIT" && str(e.a[1]) === "LENGTHUNIT" && /FOOT/i.test(str(e.a[2]))) k = 0.3048;
    const pt = (r) => { const e = E(r); return e ? [((e.a[0][0] || 0) * k), ((e.a[0][1] || 0) * k), ((e.a[0][2] || 0) * k)] : [0, 0, 0]; };
    const dir = (r, def) => { const e = E(r); return e ? norm([e.a[0][0] || 0, e.a[0][1] || 0, e.a[0][2] || 0]) : def; };

    function placement3D(r) {
      const e = E(r); if (!e) return I4();
      if (e.type === "IFCAXIS2PLACEMENT2D") { const o = pt(e.a[0]); const x = dir(e.a[1], [1, 0, 0]); const x2 = norm([x[0], x[1], 0]); return frame(x2, [-x2[1], x2[0], 0], [0, 0, 1], [o[0], o[1], 0]); }
      const o = pt(e.a[0]); const z = dir(e.a[1], [0, 0, 1]); let x = dir(e.a[2], Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
      x = norm(sub(x, z.map((c) => c * dot(x, z)))); const y = cross(z, x);
      return frame(x, y, z, o);
    }
    const cachePl = new Map();
    function localPlacement(r) {
      const e = E(r); if (!e) return I4();
      if (cachePl.has(e.id)) return cachePl.get(e.id);
      let M = I4();
      if (e.type === "IFCLOCALPLACEMENT") M = mul(localPlacement(e.a[0]), placement3D(e.a[1]));
      else avertissements.add("Placement non géré : " + e.type);
      cachePl.set(e.id, M); return M;
    }

    // Couleurs : styles poses sur les elements de forme, ou couleur du materiau
    const couleurItem = new Map();
    function couleurStyle(r) {
      const e = E(r); if (!e) return null;
      if (e.type === "IFCSURFACESTYLE") { for (const s of e.a[2] || []) { const c = couleurStyle(s); if (c) return c; } }
      if (e.type === "IFCPRESENTATIONSTYLEASSIGNMENT") { for (const s of e.a[0] || []) { const c = couleurStyle(s); if (c) return c; } }
      if (e.type === "IFCSURFACESTYLERENDERING" || e.type === "IFCSURFACESTYLESHADING") { const c = E(e.a[0]); if (c) return { rgb: [c.a[1], c.a[2], c.a[3]], alpha: 1 - (num(e.a[1]) || 0) }; }
      return null;
    }
    for (const e of ents.values()) if (e.type === "IFCSTYLEDITEM" && e.a[0]) { for (const s of e.a[1] || []) { const c = couleurStyle(s); if (c) { couleurItem.set(e.a[0].r, c); break; } } }
    const couleurMat = new Map();
    for (const e of ents.values()) if (e.type === "IFCMATERIALDEFINITIONREPRESENTATION") {
      for (const rr of e.a[2] || []) { const sr = E(rr); for (const it of (sr && sr.a[3]) || []) { const si = E(it); if (si) for (const s of si.a[1] || []) { const c = couleurStyle(s); if (c && !couleurMat.has(e.a[3].r)) couleurMat.set(e.a[3].r, c); } } }
    }

    // Relations
    const etageDe = new Map(), materiauDe = new Map(), psetsDe = new Map(), ouverturesDe = new Map(), murDeOuverture = new Map(), remplit = new Map(), parentDe = new Map();
    const etages = [];
    for (const e of ents.values()) {
      if (e.type === "IFCBUILDINGSTOREY") etages.push({ id: e.id, nom: str(e.a[2]) || "Étage", elev: (num(e.a[9]) || 0) * k });
      else if (e.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") for (const r of e.a[4] || []) etageDe.set(r.r, e.a[5].r);
      else if (e.type === "IFCRELAGGREGATES") for (const r of e.a[5] || []) parentDe.set(r.r, e.a[4].r);
      else if (e.type === "IFCRELVOIDSELEMENT") { const w = e.a[4].r; if (!ouverturesDe.has(w)) ouverturesDe.set(w, []); ouverturesDe.get(w).push(e.a[5].r); murDeOuverture.set(e.a[5].r, w); }
      else if (e.type === "IFCRELFILLSELEMENT") remplit.set(e.a[5].r, e.a[4].r);
      else if (e.type === "IFCRELASSOCIATESMATERIAL") for (const r of e.a[4] || []) materiauDe.set(r.r, e.a[5].r);
      else if (e.type === "IFCRELDEFINESBYPROPERTIES") for (const r of e.a[4] || []) { if (!psetsDe.has(r.r)) psetsDe.set(r.r, []); psetsDe.get(r.r).push(e.a[5].r); }
    }
    etages.sort((a, b) => a.elev - b.elev);
    const etageId = (id) => { let x = id, n = 0; while (x != null && n++ < 20) { if (etageDe.has(x)) return etageDe.get(x); x = parentDe.get(x); } return null; };
    function nomMateriau(r) {
      const e = ents.get(r); if (!e) return "";
      if (e.type === "IFCMATERIAL") return str(e.a[0]);
      if (e.type === "IFCMATERIALLAYERSETUSAGE") return nomMateriau(e.a[0].r);
      if (e.type === "IFCMATERIALLAYERSET") return (e.a[0] || []).map((l) => { const L = E(l); return L ? `${nomMateriau(L.a[0] && L.a[0].r)}${num(L.a[1]) ? ` (${Math.round(num(L.a[1]) * k * 1000)} mm)` : ""}` : ""; }).filter(Boolean).join(" + ");
      if (e.type === "IFCMATERIALLIST") return (e.a[0] || []).map((m) => nomMateriau(m.r)).join(", ");
      if (e.type === "IFCMATERIALCONSTITUENTSET" || e.type === "IFCMATERIALPROFILESET") return str(e.a[0]) || "";
      return str(e.a[0]);
    }
    function valeurProp(v) { if (v == null) return ""; if (typeof v === "number") return String(v); if (v.s != null) return v.s; if (v.e != null) return v.e === "T" ? "Oui" : v.e === "F" ? "Non" : v.e; if (v.t) { const x = v.v; if (typeof x === "number") return /LENGTH|POSITIVELENGTH/.test(v.t) ? `${Math.round(x * k * 1000)} mm` : String(+x.toFixed(4)); return valeurProp(x); } return ""; }
    function psets(id) {
      const out = [];
      for (const r of psetsDe.get(id) || []) {
        const p = ents.get(r); if (!p) continue;
        if (p.type === "IFCPROPERTYSET") out.push({ nom: str(p.a[2]), props: (p.a[4] || []).map((x) => E(x)).filter(Boolean).map((x) => ({ nom: str(x.a[0]), val: x.type === "IFCPROPERTYSINGLEVALUE" ? valeurProp(x.a[2]) : "…" })) });
        else if (p.type === "IFCELEMENTQUANTITY") out.push({ nom: str(p.a[2]), props: (p.a[5] || []).map((x) => E(x)).filter(Boolean).map((x) => { const v = num(x.a[3]); const t = x.type; return { nom: str(x.a[0]), val: v == null ? "" : t === "IFCQUANTITYLENGTH" ? `${Math.round(v * k * 1000)} mm` : t === "IFCQUANTITYAREA" ? `${v.toFixed(2)} m²` : t === "IFCQUANTITYVOLUME" ? `${v.toFixed(3)} m³` : String(v) }; }) });
      }
      return out;
    }

    // Geometrie d'une representation -> liste de « morceaux » { tris:[[p,p,p]], aretes:[[p,p]], couleur }
    function itemGeom(r, M, out, couleur) {
      const e = E(r); if (!e) return;
      const c = couleurItem.get(e.id) || couleur;
      const T = e.type;
      if (T === "IFCFACETEDBREP" || T === "IFCFACETEDBREPWITHVOIDS") { const sh = E(e.a[0]); for (const f of (sh && sh.a[0]) || []) faceGeom(E(f), M, out, c, e.id); }
      else if (T === "IFCSHELLBASEDSURFACEMODEL" || T === "IFCFACEBASEDSURFACEMODEL") { for (const s of e.a[0] || []) { const sh = E(s); for (const f of (sh && sh.a[0]) || []) faceGeom(E(f), M, out, c, e.id); } }
      else if (T === "IFCEXTRUDEDAREASOLID") extrusion(e, M, out, c);
      else if (T === "IFCTRIANGULATEDFACESET" || T === "IFCPOLYGONALFACESET") faceSet(e, M, out, c);
      else if (T === "IFCMAPPEDITEM") {
        const src = E(e.a[0]); const tgt = E(e.a[1]); if (!src) return;
        let Mt = I4();
        if (tgt) { const x = dir(tgt.a[0], [1, 0, 0]); const z0 = tgt.type.endsWith("3D") ? dir(tgt.a[4], [0, 0, 1]) : [0, 0, 1]; const y = cross(z0, x); const o = pt(tgt.a[2]); const s = num(tgt.a[3]) || 1; Mt = frame(x.map((v) => v * s), norm(y).map((v) => v * s), z0.map((v) => v * s), o); }
        const M2 = mul(M, mul(Mt, placement3D(src.a[0])));
        const rep = E(src.a[1]); for (const it of (rep && rep.a[3]) || []) itemGeom(it, M2, out, c);
      }
      else if (T === "IFCBOOLEANCLIPPINGRESULT" || T === "IFCBOOLEANRESULT") { itemGeom(e.a[1], M, out, c); avertissements.add("Découpes booléennes simplifiées (forme avant découpe)"); }
      else if (T === "IFCCSGSOLID") itemGeom(e.a[0], M, out, c);
      else avertissements.add("Forme non dessinée : " + T);
    }
    function boucle(r) { const e = E(r); if (!e) return []; if (e.type === "IFCPOLYLOOP") return (e.a[0] || []).map(pt); return []; }
    function faceGeom(f, M, out, c, src) {
      if (!f) return; let outer = null; const holes = [];
      for (const b of f.a[0] || []) { const B = E(b); if (!B) continue; const L = boucle(B.a[0]).map((p) => tp(M, p)); if (L.length < 3) continue; if (B.type === "IFCFACEOUTERBOUND" && !outer) outer = L; else holes.push(L); }
      if (!outer) { outer = holes.shift(); if (!outer) return; }
      out.push({ tris: triangulate3D(outer, holes), aretes: [outer, ...holes].flatMap((L) => L.map((p, i) => [p, L[(i + 1) % L.length]])), couleur: c, src });
    }
    function faceSet(e, M, out, c) {
      const pl = E(e.a[0]); const P = ((pl && pl.a[0]) || []).map((q) => tp(M, [q[0] * k, q[1] * k, (q[2] || 0) * k]));
      const tris = [], ar = [];
      if (e.type === "IFCTRIANGULATEDFACESET") { for (const t of e.a[3] || []) { const tri = t.map((i) => P[i - 1]); tris.push(tri); } }
      else for (const fr of e.a[2] || []) { const f = E(fr); if (!f) continue; const L = (f.a[0] || []).map((i) => P[i - 1]); const H = f.type === "IFCINDEXEDPOLYGONALFACEWITHVOIDS" ? (f.a[1] || []).map((h) => h.map((i) => P[i - 1])) : []; tris.push(...triangulate3D(L, H)); [L, ...H].forEach((Q) => Q.forEach((p, i) => ar.push([p, Q[(i + 1) % Q.length]]))); }
      out.push({ tris, aretes: ar, couleur: c, src: e.id });
    }
    function profil(r) {
      const e = E(r); if (!e) return null;
      const P2 = e.a[2] && E(e.a[2]) ? placement3D(e.a[2]) : I4(); const app = (L) => L.map((q) => { const p = tp(P2, [q[0], q[1], 0]); return [p[0], p[1]]; });
      if (e.type === "IFCRECTANGLEPROFILEDEF") { const x = num(e.a[3]) * k / 2, y = num(e.a[4]) * k / 2; return { outer: app([[-x, -y], [x, -y], [x, y], [-x, y]]), holes: [], rect: [x * 2, y * 2], P2 }; }
      if (e.type === "IFCCIRCLEPROFILEDEF") { const R = num(e.a[3]) * k; return { outer: app([...Array(24)].map((_, i) => [R * Math.cos(i * Math.PI / 12), R * Math.sin(i * Math.PI / 12)])), holes: [] }; }
      if (e.type === "IFCARBITRARYCLOSEDPROFILEDEF" || e.type === "IFCARBITRARYPROFILEDEFWITHVOIDS") {
        const outer = courbe2D(e.a[2]); const holes = e.type === "IFCARBITRARYPROFILEDEFWITHVOIDS" ? (e.a[3] || []).map(courbe2D) : [];
        return outer.length >= 3 ? { outer, holes } : null;
      }
      avertissements.add("Profil non dessiné : " + e.type); return null;
    }
    function courbe2D(r) {
      const e = E(r); if (!e) return [];
      let L = [];
      if (e.type === "IFCPOLYLINE") L = (e.a[0] || []).map((p) => { const q = pt(p); return [q[0], q[1]]; });
      else if (e.type === "IFCINDEXEDPOLYCURVE") { const pl = E(e.a[0]); L = ((pl && pl.a[0]) || []).map((q) => [q[0] * k, q[1] * k]); }
      else avertissements.add("Courbe non dessinée : " + e.type);
      if (L.length > 1 && Math.hypot(L[0][0] - L[L.length - 1][0], L[0][1] - L[L.length - 1][1]) < 1e-9) L.pop();
      return L;
    }
    function extrusion(e, M, out, c) {
      const pr = profil(e.a[0]); if (!pr) return;
      const M2 = mul(M, placement3D(e.a[1])); const d = dir(e.a[2], [0, 0, 1]); const h = num(e.a[3]) * k; const v = d.map((x) => x * h);
      const bas = (L) => L.map((q) => tp(M2, [q[0], q[1], 0])), haut = (L) => L.map((q) => tp(M2, [q[0] + v[0], q[1] + v[1], v[2]]));
      const tris2 = triangulate(pr.outer, pr.holes);
      const tris = [], ar = [];
      for (const t of tris2) { tris.push(bas(t)); tris.push(haut(t)); }
      for (const L of [pr.outer, ...pr.holes]) {
        const B = bas(L), H = haut(L);
        for (let i = 0; i < L.length; i++) { const j = (i + 1) % L.length; tris.push([B[i], B[j], H[j]], [B[i], H[j], H[i]]); ar.push([B[i], B[j]], [H[i], H[j]], [B[i], H[i]]); }
      }
      out.push({ tris, aretes: ar, couleur: c, src: e.id, boite: pr.rect && Math.abs(d[0]) < 1e-9 && Math.abs(d[1]) < 1e-9 ? { M: M2, w: pr.rect[0], t: pr.rect[1], h, P2: pr.P2 } : null });
    }
    function geomProduit(p) {
      const M = localPlacement(p.a[5]); const pds = E(p.a[6]); const out = [];
      if (!pds) return out;
      const base = (couleurMat.get(materiauDe.get(p.id)) || null);
      for (const rr of pds.a[2] || []) { const rep = E(rr); if (!rep) continue; const id = str(rep.a[1]); if (id && !/^(Body|Facetation|Mesh)$/i.test(id)) continue; for (const it of rep.a[3] || []) itemGeom(it, M, out, base); }
      return out;
    }

    // Mur en boite avec ouvertures : la face du mur moins les ouvertures, en vraies epaisseurs
    function murPerce(morceau, ouvertures) {
      const { M, w, t, h, P2 } = morceau.boite;
      // Repere du mur : u le long, e dans l'epaisseur, z en hauteur (dans le repere de l'extrusion)
      const long = w >= t, L = long ? w : t, T = long ? t : w;
      const Mp = mul(M, P2 || I4());
      const ux = td(Mp, long ? [1, 0, 0] : [0, 1, 0]), ex = td(Mp, long ? [0, 1, 0] : [1, 0, 0]), zx = norm(td(M, [0, 0, 1]));
      const o = tp(Mp, long ? [-L / 2, -T / 2, 0] : [-T / 2, -L / 2, 0]);
      const vers3D = (u, z, e) => [o[0] + ux[0] * u + ex[0] * e + zx[0] * z, o[1] + ux[1] * u + ex[1] * e + zx[1] * z, o[2] + ux[2] * u + ex[2] * e + zx[2] * z];
      const versUZ = (p) => { const q = sub(p, o); return [dot(q, norm(ux)), dot(q, zx), dot(q, norm(ex))]; };
      const rect = [[0, 0], [L, 0], [L, h], [0, h]];
      const trous = [];
      for (const op of ouvertures) {
        const pts = op.flatMap((m) => m.tris.flat()).map(versUZ);
        if (!pts.length) continue;
        const e0 = Math.min(...pts.map((p) => p[2])), e1 = Math.max(...pts.map((p) => p[2]));
        if (e1 < 1e-6 || e0 > T - 1e-6) continue;
        const H = hull(pts); if (H.length >= 3) trous.push(H);
      }
      let pieces = [rect];
      for (const H of trous) pieces = pieces.flatMap((P) => subtractConvex(P, H));
      const tris = [], ar = [];
      for (const P of pieces) for (let i = 1; i < P.length - 1; i++) { tris.push([vers3D(P[0][0], P[0][1], 0), vers3D(P[i][0], P[i][1], 0), vers3D(P[i + 1][0], P[i + 1][1], 0)]); tris.push([vers3D(P[0][0], P[0][1], T), vers3D(P[i][0], P[i][1], T), vers3D(P[i + 1][0], P[i + 1][1], T)]); }
      // Contour de la region (bords du mur + bords des ouvertures), extrude dans l'epaisseur
      const segs = [];
      const ajoute = (P) => P.forEach((a, i) => segs.push([a, P[(i + 1) % P.length]]));
      ajoute(rect); for (const H of trous) { const c = clipToRect(H, L, h); if (c) ajoute(c); }
      const dedans = (q) => q[0] > 1e-7 && q[0] < L - 1e-7 && q[1] > 1e-7 && q[1] < h - 1e-7 && !trous.some((H) => insideConvex(H, q, 1e-9));
      for (const [a, b] of segs) {
        const ts = [0, 1];
        for (const [c, d] of segs) { const r = interT(a, b, c, d); if (r != null) ts.push(r); }
        ts.sort((x, y) => x - y);
        for (let i = 0; i < ts.length - 1; i++) {
          if (ts[i + 1] - ts[i] < 1e-9) continue;
          const p = [a[0] + (b[0] - a[0]) * ts[i], a[1] + (b[1] - a[1]) * ts[i]], q = [a[0] + (b[0] - a[0]) * ts[i + 1], a[1] + (b[1] - a[1]) * ts[i + 1]];
          const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], n = norm([-(q[1] - p[1]), q[0] - p[0], 0]), eps = 1e-4;
          if (dedans([m[0] + n[0] * eps, m[1] + n[1] * eps]) === dedans([m[0] - n[0] * eps, m[1] - n[1] * eps])) continue;
          const A0 = vers3D(p[0], p[1], 0), B0 = vers3D(q[0], q[1], 0), A1 = vers3D(p[0], p[1], T), B1 = vers3D(q[0], q[1], T);
          tris.push([A0, B0, B1], [A0, B1, A1]); ar.push([A0, B0], [A1, B1]);
        }
      }
      // aretes verticales aux sommets du contour
      const nette = pieces.reduce((s, P) => s + Math.abs(area2(P)), 0);
      return { morceau: { tris, aretes: dedupAretes(ar, vers3D, T), couleur: morceau.couleur, src: morceau.src }, L, h, T, brute: L * h, nette, nbTrous: trous.length };
    }
    function dedupAretes(ar, vers3D, T) {
      // ajoute les aretes dans l'epaisseur aux extremites des segments du contour
      const vus = new Map(); const cle = (p) => p.map((v) => v.toFixed(4)).join(",");
      const out = ar.slice();
      for (const [a, b] of ar) for (const p of [a, b]) { const c = cle(p); vus.set(c, (vus.get(c) || 0) + 1); }
      return out;
    }
    function clipToRect(H, L, h) { let P = H; for (const [a, b] of [[[0, 0], [L, 0]], [[L, 0], [L, h]], [[L, h], [0, h]], [[0, h], [0, 0]]]) { P = clipHalf(P, a, b, true); if (!P) return null; } return P; }
    function interT(a, b, c, d) {
      const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]]; const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) return null;
      const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
      return t > 1e-9 && t < 1 - 1e-9 && u > -1e-9 && u < 1 + 1e-9 ? t : null;
    }

    // ---------- Produits ----------
    const produits = [];
    const geomOuv = new Map();
    for (const e of ents.values()) if (e.type === "IFCOPENINGELEMENT") geomOuv.set(e.id, geomProduit(e));
    for (const e of ents.values()) {
      if (PAS_DESSINES.has(e.type)) continue;
      const pds = E(e.a && e.a[6]); if (!pds || pds.type !== "IFCPRODUCTDEFINITIONSHAPE") continue;
      let morceaux = geomProduit(e);
      if (!morceaux.length) continue;
      const fr = TYPES_FR[e.type] || e.type.replace(/^IFC/, "").toLowerCase().replace(/^./, (c) => c.toUpperCase());
      const p = { id: e.id, ifc: e.type, type: fr, nom: str(e.a[2]) || fr, gid: str(e.a[0]), desc: str(e.a[3]), objType: str(e.a[4]), etage: etageId(e.id), materiau: materiauDe.has(e.id) ? nomMateriau(materiauDe.get(e.id)) : "", psets: psets(e.id), mur: null };
      if (/^IFCWALL/.test(e.type) && ouverturesDe.has(e.id) && morceaux.length === 1 && morceaux[0].boite) {
        const r = murPerce(morceaux[0], ouverturesDe.get(e.id).map((o) => geomOuv.get(o) || []));
        morceaux = [r.morceau]; p.surf = { L: r.L, h: r.h, T: r.T, brute: r.brute, nette: r.nette, trous: r.nbTrous };
      } else if (ouverturesDe.has(e.id)) avertissements.add("Ouvertures non découpées dans certains éléments (forme complexe)");
      else if (/^IFCWALL/.test(e.type) && morceaux.length === 1 && morceaux[0].boite) { const b = morceaux[0].boite; const L = Math.max(b.w, b.t), T = Math.min(b.w, b.t); p.surf = { L, h: b.h, T, brute: L * b.h, nette: L * b.h, trous: 0 }; }
      // Fenetres et portes : la vitre (piece la plus fine) en bleu translucide
      if ((e.type === "IFCWINDOW" || e.type === "IFCDOOR") && morceaux.length > 1) {
        const groupes = new Map(); for (const m of morceaux) { if (!groupes.has(m.src)) groupes.set(m.src, []); groupes.get(m.src).push(m); }
        if (groupes.size > 1) for (const g of groupes.values()) { const bb = bbox(g.flatMap((m) => m.tris.flat())); const d = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]].sort((a, b) => a - b); if (d[0] < 0.035) g.forEach((m) => (m.verre = true)); }
      }
      if (e.type === "IFCWINDOW" || e.type === "IFCDOOR") {
        const H = num(e.a[8]), W = num(e.a[9]);
        // valeurs en unites du modele ; certains logiciels ecrivent des mm meme en metres
        const mm = (v) => (v == null ? null : Math.round(v * k > 50 ? v : v * k * 1000));
        p.hauteur = mm(H); p.largeur = mm(W);
      }
      p.morceaux = morceaux;
      p.bb = bbox(morceaux.flatMap((m) => m.tris.flat()));
      produits.push(p);
    }
    // Mur qui porte chaque fenetre / porte : relation IFC si presente, sinon par position
    const parId = new Map(produits.map((p) => [p.id, p]));
    for (const p of produits) {
      if (p.ifc !== "IFCWINDOW" && p.ifc !== "IFCDOOR") continue;
      const op = remplit.get(p.id); if (op && murDeOuverture.has(op) && parId.has(murDeOuverture.get(op))) { p.mur = murDeOuverture.get(op); continue; }
      const c = p.bb.min.map((v, i) => (v + p.bb.max[i]) / 2);
      let best = null, bd = Infinity;
      for (const w of produits) {
        if (!/^IFCWALL/.test(w.ifc)) continue;
        const m = 0.08; const ins = c.every((v, i) => v >= w.bb.min[i] - m && v <= w.bb.max[i] + m);
        if (!ins) continue;
        const vol = (w.bb.max[0] - w.bb.min[0]) * (w.bb.max[1] - w.bb.min[1]) * (w.bb.max[2] - w.bb.min[2]);
        if (vol < bd) { bd = vol; best = w.id; }
      }
      p.mur = best;
    }
    const projet = [...ents.values()].find((e) => e.type === "IFCPROJECT");
    const app = [...ents.values()].find((e) => e.type === "IFCAPPLICATION");
    return {
      schema, produits, etages, avertissements: [...avertissements],
      projet: projet ? str(projet.a[2]) || "Sans nom" : "Sans nom",
      logiciel: app ? `${str(app.a[2])} ${str(app.a[1])}`.trim() : "",
      nbEntites: ents.size,
      aPsets: produits.some((p) => p.psets.length),
      bbTout: bbox(produits.flatMap((p) => [p.bb.min, p.bb.max])),
    };
  }
  function bbox(pts) { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (const p of pts) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; } return { min, max }; }


  // ---------- Coupe 2D et export DXF ----------
  const CALQUES = { MUR: 7, FENETRE: 4, PORTE: 30, VITRAGE: 5, DALLE: 8, TOITURE: 1, ESCALIER: 6, DIVERS: 9, VU: 253, TEXTE: 2 };
  function calqueDe(p, m) {
    if (m && m.verre) return "VITRAGE";
    if (/^IFCWALL|IFCCURTAINWALL/.test(p.ifc)) return "MUR";
    return { IFCWINDOW: "FENETRE", IFCDOOR: "PORTE", IFCSLAB: "DALLE", IFCROOF: "TOITURE", IFCSTAIR: "ESCALIER", IFCSTAIRFLIGHT: "ESCALIER" }[p.ifc] || "DIVERS";
  }
  // coupe = { axe: "z" | "x" | "y", v } ; on garde le cote <= v, regarde depuis le cote > v
  // Repere 2D (en m) : plan (x, y) ; coupe ⊥ X vue depuis +X : (y, z) ; coupe ⊥ Y vue depuis +Y : (-x, z)
  function vers2D(axe, p) { return axe === "z" ? [p[0], p[1]] : axe === "x" ? [p[1], p[2]] : [-p[0], p[2]]; }
  function couper(model, coupe, visible = () => true, avecVus = false) {
    const ax = { x: 0, y: 1, z: 2 }[coupe.axe], v = coupe.v, segs = [];
    model.produits.forEach((p, pi) => {
      if (!visible(pi)) return;
      for (const m of p.morceaux) {
        const calque = calqueDe(p, m);
        for (const t of m.tris) {
          const d = t.map((q) => q[ax] - v);
          if (d.every((x) => Math.abs(x) < 1e-7)) continue;
          const pts = [];
          for (let i = 0; i < 3; i++) {
            const a = t[i], b = t[(i + 1) % 3], da = d[i], db = d[(i + 1) % 3];
            if (Math.abs(da) < 1e-7) pts.push(a);
            else if ((da < 0 && db > 1e-7) || (da > 0 && db < -1e-7)) { const k = da / (da - db); pts.push([a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1]), a[2] + k * (b[2] - a[2])]); }
          }
          const u = [];
          for (const q of pts) if (!u.some((w) => Math.hypot(w[0] - q[0], w[1] - q[1], w[2] - q[2]) < 1e-6)) u.push(q);
          if (u.length === 2) segs.push({ a: vers2D(coupe.axe, u[0]), b: vers2D(coupe.axe, u[1]), calque, pi });
        }
        if (avecVus && !m.verre) for (const [a, b] of m.aretes) if (a[ax] <= v + 1e-7 && b[ax] <= v + 1e-7) segs.push({ a: vers2D(coupe.axe, a), b: vers2D(coupe.axe, b), calque: "VU", pi });
      }
    });
    return fusionner(segs);
  }
  // Supprime les doublons et raboute les traits alignes qui se touchent (moins de lignes dans AutoCAD)
  function fusionner(segs) {
    const cle = (q) => `${Math.round(q[0] * 1e4)},${Math.round(q[1] * 1e4)}`;
    const vus = new Set(), parCalque = new Map();
    for (const s of segs) {
      if (Math.hypot(s.a[0] - s.b[0], s.a[1] - s.b[1]) < 1e-5) continue;
      const k1 = cle(s.a), k2 = cle(s.b), k = `${s.calque}|${k1 < k2 ? k1 + "|" + k2 : k2 + "|" + k1}`;
      if (vus.has(k)) continue; vus.add(k);
      if (!parCalque.has(s.calque)) parCalque.set(s.calque, []);
      parCalque.get(s.calque).push({ ...s });
    }
    const out = [];
    for (const [calque, L] of parCalque) {
      let change = true, tour = 0;
      while (change && tour++ < 8) {
        change = false;
        const bout = new Map();
        L.forEach((s, i) => { for (const q of [s.a, s.b]) { const k = cle(q); if (!bout.has(k)) bout.set(k, []); bout.get(k).push(i); } });
        const mort = new Set();
        for (const [, idx] of bout) {
          const vivants = idx.filter((i) => !mort.has(i));
          if (vivants.length !== 2) continue;
          const [i, j] = vivants, s = L[i], t = L[j];
          const d1 = [s.b[0] - s.a[0], s.b[1] - s.a[1]], d2 = [t.b[0] - t.a[0], t.b[1] - t.a[1]];
          if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) > 1e-6 * Math.hypot(...d1) * Math.hypot(...d2)) continue;
          const pts = [s.a, s.b, t.a, t.b]; let best = [0, 1], bd = -1;
          for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) { const dd = Math.hypot(pts[x][0] - pts[y][0], pts[x][1] - pts[y][1]); if (dd > bd) { bd = dd; best = [x, y]; } }
          s.a = pts[best[0]]; s.b = pts[best[1]]; mort.add(j); change = true;
        }
        if (change) { const reste = L.filter((_, i) => !mort.has(i)); L.length = 0; L.push(...reste); }
      }
      for (const s of L) out.push({ ...s, calque });
    }
    return out;
  }
  const ascii = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");
  function dxf(segs, titre) {
    const f = (x) => (Math.round(x * 1000 * 1000) / 1000).toString(); // m -> mm
    const L = []; const g = (c, v) => L.push(String(c), String(v));
    let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    for (const s of segs) for (const q of [s.a, s.b]) { mn = [Math.min(mn[0], q[0]), Math.min(mn[1], q[1])]; mx = [Math.max(mx[0], q[0]), Math.max(mx[1], q[1])]; }
    if (!isFinite(mn[0])) { mn = [0, 0]; mx = [1, 1]; }
    const calques = [...new Set(segs.map((s) => s.calque)), "TEXTE"];
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSBASE"); g(10, 0); g(20, 0); g(30, 0);
    g(9, "$EXTMIN"); g(10, f(mn[0])); g(20, f(mn[1] - 0.6)); g(30, 0); g(9, "$EXTMAX"); g(10, f(mx[0])); g(20, f(mx[1])); g(30, 0); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES");
    g(0, "TABLE"); g(2, "LTYPE"); g(70, 1); g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, "0.0"); g(0, "ENDTAB");
    g(0, "TABLE"); g(2, "LAYER"); g(70, calques.length);
    for (const c of calques) { g(0, "LAYER"); g(2, `IFC-${c}`); g(70, 0); g(62, CALQUES[c] || 7); g(6, "CONTINUOUS"); }
    g(0, "ENDTAB"); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    for (const s of segs) { g(0, "LINE"); g(8, `IFC-${s.calque}`); g(10, f(s.a[0])); g(20, f(s.a[1])); g(30, 0); g(11, f(s.b[0])); g(21, f(s.b[1])); g(31, 0); }
    g(0, "TEXT"); g(8, "IFC-TEXTE"); g(10, f(mn[0])); g(20, f(mn[1] - 0.5)); g(30, 0); g(40, 150); g(1, ascii(titre));
    g(0, "ENDSEC"); g(0, "EOF");
    return L.join("\r\n") + "\r\n";
  }


  // Regroupe les triangles coplanaires et contigus en faces polygonales (contour + trous), pour un STEP propre dans les logiciels de CAO.
  // Si le contour ne se referme pas proprement (sommets en T), les triangles de ce plan sont gardes tels quels.
  function facesPlanes(tris) {
    const cle3 = (q) => q.map((v) => Math.round(v * 1e5)).join(",");
    const plans = new Map();
    for (const t of tris) {
      let n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0]))); if (!isFinite(n[0])) continue;
      const neg = n[0] < -1e-9 || (Math.abs(n[0]) <= 1e-9 && (n[1] < -1e-9 || (Math.abs(n[1]) <= 1e-9 && n[2] < 0)));
      if (neg) n = n.map((v) => -v);
      const d = dot(n, t[0]);
      const k = `${n.map((v) => Math.round(v * 1e4)).join(",")}|${Math.round(d * 1e4)}`;
      if (!plans.has(k)) plans.set(k, { n, tris: [] });
      plans.get(k).tris.push(t);
    }
    const out = [];
    for (const { n, tris: T } of plans.values()) {
      if (T.length === 1) { out.push({ boucles: [T[0]] }); continue; }
      const pts = new Map(), aretes = new Map();
      for (const t of T) for (const q of t) pts.set(cle3(q), q);
      const tous = [...pts.values()];
      for (const t of T) for (let i = 0; i < 3; i++) {
        // une arete est coupee aux sommets voisins poses dessus (jonctions en T des murs perces)
        const a = t[i], b = t[(i + 1) % 3], ab = sub(b, a), L2 = dot(ab, ab);
        const coupes = [0, 1];
        for (const q of tous) { const aq = sub(q, a), k = dot(aq, ab) / L2; if (k > 1e-6 && k < 1 - 1e-6 && len(cross(aq, ab)) / Math.sqrt(L2) < 1e-6) coupes.push(k); }
        coupes.sort((x, y) => x - y);
        for (let j = 0; j < coupes.length - 1; j++) {
          const p0 = [0, 1, 2].map((c) => a[c] + ab[c] * coupes[j]), p1 = [0, 1, 2].map((c) => a[c] + ab[c] * coupes[j + 1]);
          const ka = cle3(p0), kb = cle3(p1); if (ka === kb) continue;
          if (!pts.has(ka)) pts.set(ka, p0); if (!pts.has(kb)) pts.set(kb, p1);
          const k = ka < kb ? ka + "|" + kb : kb + "|" + ka;
          aretes.set(k, (aretes.get(k) || 0) + 1);
        }
      }
      const bord = new Map(); let ok = true;
      for (const [k, c] of aretes) if (c === 1) { const [a, b] = k.split("|"); for (const [x, y] of [[a, b], [b, a]]) { if (!bord.has(x)) bord.set(x, []); bord.get(x).push(y); } }
      for (const v of bord.values()) if (v.length !== 2) ok = false;
      if (!ok || !bord.size) { for (const t of T) out.push({ boucles: [t] }); continue; }
      // chainer les aretes de bord en boucles
      const vus = new Set(), boucles = [];
      for (const depart of bord.keys()) {
        if (vus.has(depart)) continue;
        const B = [depart]; vus.add(depart); let prec = null, cur = depart, garde = 0;
        while (garde++ < 100000) { const [x, y] = bord.get(cur); const suiv = x !== prec ? x : y; if (suiv === depart) break; if (vus.has(suiv)) { ok = false; break; } B.push(suiv); vus.add(suiv); prec = cur; cur = suiv; }
        boucles.push(B.map((k) => pts.get(k)).filter((p, i, A) => { const a = A[(i + A.length - 1) % A.length], c = A[(i + 1) % A.length]; return len(cross(sub(p, a), sub(c, p))) > 1e-10; }));
      }
      if (!ok || boucles.some((B) => B.length < 3)) { for (const t of T) out.push({ boucles: [t] }); continue; }
      // contours exterieurs et trous (un trou est contenu dans un autre contour)
      const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
      const [u, v] = ax === 0 ? [1, 2] : ax === 1 ? [2, 0] : [0, 1];
      const P2 = boucles.map((B) => B.map((p) => [p[u], p[v]]));
      const aire = (P) => Math.abs(area2(P));
      const dans = (q, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
      const parent = P2.map((P, i) => { let best = -1; P2.forEach((Q, j) => { if (j !== i && aire(Q) > aire(P) && dans(P[0], Q) && (best < 0 || aire(Q) < aire(P2[best]))) best = j; }); return best; });
      const profondeur = (i) => { let d = 0, x = parent[i]; while (x >= 0 && d < 50) { d++; x = parent[x]; } return d; };
      boucles.forEach((B, i) => { if (profondeur(i) % 2 === 0) out.push({ boucles: [B, ...boucles.filter((_, j) => parent[j] === i && profondeur(j) % 2 === 1)] }); });
    }
    return out;
  }

  // Faces planes d'une forme, en cles de sommets, avec les aretes rendues coherentes entre faces voisines
  // (chaque arete d'un solide ferme est parcourue une fois dans chaque sens) et orientees vers l'exterieur.
  function topologie(tris) {
    const cle3 = (q) => q.map((v) => Math.round(v * 1e5)).join(",");
    const pts = new Map(), vus = new Set();
    // triangles en double (ex. tableaux d'ouverture generes deux fois) : on n'en garde qu'un
    tris = tris.filter((t) => { const k = t.map(cle3).sort().join("/"); if (vus.has(k)) return false; vus.add(k); return true; });
    let faces = facesPlanes(tris).map((f) => f.boucles.map((B) => B.map((q) => { const k = cle3(q); if (!pts.has(k)) pts.set(k, q); return k; })));
    // sommets utiles = coins d'au moins une face ; on les reinsere sur les aretes des autres faces qui passent dessus
    const coins = new Set(); for (const F of faces) for (const B of F) for (const k of B) coins.add(k);
    const V = [...coins].map((k) => [k, pts.get(k)]);
    const surArete = (a, b) => {
      const A = pts.get(a), ab = sub(pts.get(b), A), L2 = dot(ab, ab), r = [];
      for (const [k, q] of V) { if (k === a || k === b) continue; const aq = sub(q, A), t = dot(aq, ab) / L2; if (t > 1e-7 && t < 1 - 1e-7 && len(cross(aq, ab)) / Math.sqrt(L2) < 2e-6) r.push([t, k]); }
      return r.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    };
    faces = faces.map((F) => F.map((B) => { const R = []; B.forEach((a, i) => { R.push(a, ...surArete(a, B[(i + 1) % B.length])); }); return R.filter((k, i) => k !== R[(i + 1) % R.length]); }).filter((B) => B.length >= 3)).filter((F) => F.length);
    const newell = (B) => { const n = [0, 0, 0]; B.forEach((k, i) => { const p = pts.get(k), q = pts.get(B[(i + 1) % B.length]); n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); }); return n; };
    // dans une face, les trous tournent a l'inverse du contour
    for (const F of faces) { const n0 = newell(F[0]); for (let i = 1; i < F.length; i++) if (dot(newell(F[i]), n0) > 0) F[i].reverse(); }
    // voisinage par aretes
    const usage = new Map();
    faces.forEach((F, fi) => F.forEach((B) => B.forEach((a, j) => { const b = B[(j + 1) % B.length], k = a < b ? a + "|" + b : b + "|" + a; if (!usage.has(k)) usage.set(k, []); usage.get(k).push([fi, a < b]); })));
    let ferme = [...usage.values()].every((u) => u.length === 2);
    if (ferme) {
      // orientation coherente de proche en proche : une arete commune est parcourue en sens opposes
      const sens = new Array(faces.length).fill(0);
      for (let s0 = 0; s0 < faces.length && ferme; s0++) {
        if (sens[s0]) continue; sens[s0] = 1; const pile = [s0];
        while (pile.length && ferme) {
          const fi = pile.pop();
          for (const B of faces[fi]) B.forEach((a, j) => {
            const b = B[(j + 1) % B.length], k = a < b ? a + "|" + b : b + "|" + a;
            const [x, y] = usage.get(k), [mi, autre] = x[0] === fi ? [x, y] : [y, x];
            if (autre[0] === fi) { ferme = false; return; }
            const voulu = sens[fi] * (mi[1] === autre[1] ? -1 : 1);
            if (!sens[autre[0]]) { sens[autre[0]] = voulu; pile.push(autre[0]); } else if (sens[autre[0]] !== voulu) ferme = false;
          });
        }
      }
      if (ferme) faces.forEach((F, fi) => { if (sens[fi] < 0) F.forEach((B) => B.reverse()); });
      // volume signe : negatif = faces tournees vers l'interieur, on retourne tout
      if (ferme) { let vol = 0; for (const F of faces) for (const B of F) vol += dot(newell(B), pts.get(B[0])); if (vol < 0) faces.forEach((F) => F.forEach((B) => B.reverse())); }
    }
    return { pts, faces, ferme };
  }

  // ---------- Export STEP (AP214) : un solide B-rep a faces planes par forme, une piece par element, le tout en assemblage ----------
  // Texte du STEP : caracteres hors ASCII codes en \X2\....\X0\ (lisible par tous les logiciels)
  const stepStr = (t) => "'" + String(t ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/[^\x20-\x7e]+/g, (m) => "\\X2\\" + [...m].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("") + "\\X0\\") + "'";
  function step(model, indices, opts = {}) {
    const L = []; let n = 0;
    const e = (txt) => { n++; L.push(`#${n}=${txt};`); return n; };
    const num = (v) => { const r = Math.round(v * 1e4) / 1e4; return Number.isInteger(r) ? r.toFixed(1) : String(r); };
    const ctx = e("APPLICATION_CONTEXT('automotive design')");
    e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${ctx})`);
    const uL = e("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
    const uA = e("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
    const uS = e("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
    const unc = e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-02),#${uL},'distance_accuracy_value','')`);
    const gctx = e(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${uL},#${uA},#${uS}))REPRESENTATION_CONTEXT('Maquette','3D'))`);
    const pctx = e(`PRODUCT_CONTEXT('',#${ctx},'mechanical')`);
    const pdctx = e(`PRODUCT_DEFINITION_CONTEXT('part definition',#${ctx},'design')`);
    const o = e("CARTESIAN_POINT('',(0.,0.,0.))"), dz = e("DIRECTION('',(0.,0.,1.))"), dx = e("DIRECTION('',(1.,0.,0.))");
    const axe = () => e(`AXIS2_PLACEMENT_3D('',#${o},#${dz},#${dx})`);
    function produit(nom) {
      const p = e(`PRODUCT(${stepStr(nom)},${stepStr(nom)},'',(#${pctx}))`);
      e(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${p}))`);
      const f = e(`PRODUCT_DEFINITION_FORMATION('','',#${p})`);
      const d = e(`PRODUCT_DEFINITION('design','',#${f},#${pdctx})`);
      const s = e(`PRODUCT_DEFINITION_SHAPE('','',#${d})`);
      return { d, s };
    }
    // Assemblage racine
    const racine = produit(opts.nom || model.projet || "Maquette");
    const axR = axe();
    const srR = e(`SHAPE_REPRESENTATION('',(#${axR}),#${gctx})`);
    e(`SHAPE_DEFINITION_REPRESENTATION(#${racine.s},#${srR})`);
    let nbPieces = 0, nbFaces = 0, nbSolides = 0, nbSurfaces = 0;
    indices.forEach((pi, k) => {
      const p = model.produits[pi];
      // une forme fermee par element de geometrie IFC (src) : cadre et vitre restent deux solides
      const groupes = new Map();
      for (const m of p.morceaux) { if (!groupes.has(m.src)) groupes.set(m.src, []); groupes.get(m.src).push(...m.tris); }
      const breps = []; let toutSolide = true;
      for (const tris of groupes.values()) {
        const S = topologie(tris);
        if (!S.faces.length) continue;
        nbFaces += S.faces.length;
        // sommets et aretes partages entre faces : c'est ce qui fait un vrai solide pour AutoCAD
        const vtx = new Map(), ar = new Map();
        const sommet = (k) => { if (!vtx.has(k)) vtx.set(k, e(`VERTEX_POINT('',#${e(`CARTESIAN_POINT('',(${S.pts.get(k).map((v) => num(v * 1000)).join(",")}))`)})`)); return vtx.get(k); };
        const arete = (a, b) => {
          const k = a < b ? a + "|" + b : b + "|" + a, sens = a < b;
          if (!ar.has(k)) {
            const [x, y] = a < b ? [a, b] : [b, a], P = S.pts.get(x), Q = S.pts.get(y), d = sub(Q, P), l = len(d);
            const ln = e(`LINE('',#${e(`CARTESIAN_POINT('',(${P.map((v) => num(v * 1000)).join(",")}))`)},#${e(`VECTOR('',#${e(`DIRECTION('',(${d.map((v) => num(v / l)).join(",")}))`)},${num(l * 1000)})`)})`);
            ar.set(k, e(`EDGE_CURVE('',#${sommet(x)},#${sommet(y)},#${ln},.T.)`));
          }
          return `#${e(`ORIENTED_EDGE('',*,*,#${ar.get(k)},${sens ? ".T." : ".F."})`)}`;
        };
        const faces = S.faces.map((F) => {
          const bounds = F.map((B, i) => {
            const loop = e(`EDGE_LOOP('',(${B.map((a, j) => arete(a, B[(j + 1) % B.length])).join(",")}))`);
            return `#${e(`${i === 0 ? "FACE_OUTER_BOUND" : "FACE_BOUND"}('',#${loop},.T.)`)}`;
          });
          return `#${e(`ADVANCED_FACE('',(${bounds.join(",")}),#${plan(F[0].map((k) => S.pts.get(k)))},.T.)`)}`;
        });
        if (S.ferme) breps.push(e(`MANIFOLD_SOLID_BREP(${stepStr(p.nom)},#${e(`CLOSED_SHELL('',(${faces.join(",")}))`)})`));
        else { toutSolide = false; breps.push(e(`SHELL_BASED_SURFACE_MODEL(${stepStr(p.nom)},(#${e(`OPEN_SHELL('',(${faces.join(",")}))`)}))`)); }
        S.ferme ? nbSolides++ : nbSurfaces++;
      }
      if (!breps.length) return;
      const pr = produit(p.nom);
      const ax = axe();
      const sr = e(`${toutSolide ? "ADVANCED_BREP_SHAPE_REPRESENTATION" : "SHAPE_REPRESENTATION"}(${stepStr(p.nom)},(${[...breps, ax].map((i) => "#" + i).join(",")}),#${gctx})`);
      e(`SHAPE_DEFINITION_REPRESENTATION(#${pr.s},#${sr})`);
      const nauo = e(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${k + 1}',${stepStr(p.nom)},'',#${racine.d},#${pr.d},$)`);
      const pds = e(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
      const idt = e(`ITEM_DEFINED_TRANSFORMATION('','',#${axR},#${ax})`);
      const rr = e(`(REPRESENTATION_RELATIONSHIP('','',#${sr},#${srR})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`);
      e(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rr},#${pds})`);
      nbPieces++;
    });
    // Plan porteur d'une face (point + normale de Newell, robuste pour un polygone)
    function plan(t) {
      const a = t[0], u = [t[1][0] - a[0], t[1][1] - a[1], t[1][2] - a[2]];
      const nw = [0, 0, 0]; for (let i = 0; i < t.length; i++) { const p = t[i], q = t[(i + 1) % t.length]; nw[0] += (p[1] - q[1]) * (p[2] + q[2]); nw[1] += (p[2] - q[2]) * (p[0] + q[0]); nw[2] += (p[0] - q[0]) * (p[1] + q[1]); }
      let nn = norm(nw); if (!isFinite(nn[0])) nn = [0, 0, 1];
      let rx = norm(u); if (!isFinite(rx[0])) rx = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const c = e(`CARTESIAN_POINT('',(${a.map((x) => num(x * 1000)).join(",")}))`);
      const d1 = e(`DIRECTION('',(${nn.map(num).join(",")}))`), d2 = e(`DIRECTION('',(${rx.map(num).join(",")}))`);
      return e(`PLANE('',#${e(`AXIS2_PLACEMENT_3D('',#${c},#${d1},#${d2})`)})`);
    }
    const date = (opts.date || new Date().toISOString()).slice(0, 19);
    const nomFichier = (opts.fichier || "maquette.stp").replace(/'/g, "");
    const texte = ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('Export Maquette'),'2;1');",
      `FILE_NAME(${stepStr(nomFichier)},'${date}',(''),(''),'Maquette','Maquette','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", "ENDSEC;", "DATA;", ...L, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
    return { texte, nbPieces, nbFaces, nbSolides, nbSurfaces };
  }

  const couleurType = (ifc) => COULEURS[ifc] || [0.62, 0.64, 0.66];
  return { build, bbox, triangulate, subtractConvex, hull, couper, dxf, step, stepStr, topologie, calqueDe, CALQUES, couleurType, VERRE };
})();
export default IFC;
