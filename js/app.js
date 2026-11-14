// Maquette : affichage (vue 3D WebGL, contenu, fiche, listes, mesures, coupes DXF) et bandeau commun.
// La lecture du fichier et la geometrie sont dans core.js (lancees dans worker.js pour ne pas figer la page).
import IFC from "./core.js?v=1.17";

const VERSION = "1.17";
// Appli en preparation : reservee au concepteur tant qu'Hugo ne l'ouvre pas a l'equipe (passer a false pour l'ouvrir)
const RESERVEE_CONCEPTEUR = true;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const mm = (m) => Math.round(m * 1000).toLocaleString("fr-CH");
  const m2 = (v) => v.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let M = null; // modele
  let nomFichier = "";
  const etat = { cache: new Set(), caches: new Set(), isole: null, sel: null, coupe: null, mesure: false, pts: [], survol: null, face: null };

  // ---------- Camera ----------
  const cv = $("#vue");
  const cam = { cible: [0, 0, 0], dist: 10, th: -0.95, ph: 0.42, ortho: false, ech: 50, fov: 0.75 };
  let W = 0, H = 0, dpr = 1;
  function repere() {
    const e = [cam.cible[0] + cam.dist * Math.cos(cam.ph) * Math.cos(cam.th), cam.cible[1] + cam.dist * Math.cos(cam.ph) * Math.sin(cam.th), cam.cible[2] + cam.dist * Math.sin(cam.ph)];
    const f = nrm([cam.cible[0] - e[0], cam.cible[1] - e[1], cam.cible[2] - e[2]]);
    let r = nrm(crs(f, [0, 0, 1])); if (!isFinite(r[0]) || Math.hypot(...r) < 0.5) r = [1, 0, 0];
    const u = crs(r, f);
    return { e, f, r, u, F: H / 2 / Math.tan(cam.fov / 2) };
  }
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // ---------- Geometrie a dessiner ----------
  // Geometrie : lue directement dans les pieces compactes du modele (Float32, relatives a leur origine m.o)
  // O : centre de la maquette, les positions envoyees a la carte graphique lui sont relatives (precision)
  let O = [0, 0, 0], sigPrec = null;
  const LUM = nrm([-0.45, -0.7, 0.85]);
  // Comparaison : couleur par statut (les pieces identiques restent en gris fantome)
  const CMP = { ajoute: { rgb: [0.16, 0.62, 0.30], a: 1, nom: "Ajouté", css: "#29a04d" }, supprime: { rgb: [0.86, 0.22, 0.22], a: 0.62, nom: "Supprimé", css: "#dc3838" }, modifie: { rgb: [0.96, 0.62, 0.10], a: 1, nom: "Modifié", css: "#f59e1a" }, deplace: { rgb: [0.22, 0.50, 0.92], a: 1, nom: "Déplacé", css: "#3880ea" }, identique: { rgb: [0.62, 0.64, 0.67], a: 0.16, nom: "Identique", css: "#9ea3aa" } };
  function couleurDe(p, m) {
    if (p.cmp) return { rgb: CMP[p.cmp].rgb, a: CMP[p.cmp].a };
    if (m.verre) return { rgb: IFC.VERRE, a: 0.42 };
    const c = m.couleur ? m.couleur.rgb : IFC.couleurType(p.ifc);
    return { rgb: c, a: m.couleur && m.couleur.alpha < 0.99 ? m.couleur.alpha : 1 };
  }
  // Decoupe d'un polygone par le plan de coupe (on garde le cote <= valeur)
  const AXE = { x: 0, y: 1, z: 2 };
  function coupeZ(P, c) {
    if (!c) return P;
    const k = AXE[c.axe], zc = c.v, out = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], ia = a[k] <= zc, ib = b[k] <= zc;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (zc - a[k]) / (b[k] - a[k]); const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]; q[k] = zc; out.push(q); }
    }
    return out;
  }
  function construire() {
    const b = M.bbTout; O = b.min.map((v, i) => (v + b.max[i]) / 2);
    sigPrec = null; envoyer();
  }
  // Triangles d'un element, deja decoupes par la coupe : f(ax,ay,az, bx,by,bz, cx,cy,cz, m)
  function pourTriangles(p, f) {
    const zc = etat.coupe, k = zc ? AXE[zc.axe] : 0, v = zc ? zc.v : 0;
    for (const m of p.morceaux) {
      const T = m.T, o = m.o;
      for (let i = 0; i < T.length; i += 9) {
        const a = [T[i] + o[0], T[i + 1] + o[1], T[i + 2] + o[2]], b = [T[i + 3] + o[0], T[i + 4] + o[1], T[i + 5] + o[2]], c = [T[i + 6] + o[0], T[i + 7] + o[1], T[i + 8] + o[2]];
        if (!zc || (a[k] <= v && b[k] <= v && c[k] <= v)) { f(a, b, c, m); continue; }
        const P = coupeZ([a, b, c], zc); for (let j = 1; j < P.length - 1; j++) f(P[0], P[j], P[j + 1], m);
      }
    }
  }
  // Remplissage de la coupe : segments de coupe de chaque piece, chaines en contours, triangules dans le plan
  function capuchons(p, tri, arete) {
    const zc = etat.coupe, k = AXE[zc.axe], v = zc.v, i1 = k === 0 ? 1 : 0, i2 = k === 2 ? 1 : 2;
    for (const m of p.morceaux) {
      if (m.verre) continue;
      const T = m.T, o = m.o, segs = [];
      for (let i = 0; i < T.length; i += 9) {
        const P = [0, 1, 2].map((j) => [T[i + j * 3] + o[0], T[i + j * 3 + 1] + o[1], T[i + j * 3 + 2] + o[2]]), d = P.map((q) => q[k] - v);
        if ((d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] < 0 && d[1] < 0 && d[2] < 0)) continue;
        const pts = [];
        for (let j = 0; j < 3; j++) { const a = P[j], b = P[(j + 1) % 3], da = d[j], db = d[(j + 1) % 3]; if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); pts.push([a[i1] + (b[i1] - a[i1]) * t, a[i2] + (b[i2] - a[i2]) * t]); } else if (da === 0) pts.push([a[i1], a[i2]]); }
        if (pts.length === 2) segs.push(pts);
      }
      if (segs.length < 3) continue;
      const cle = (q) => Math.round(q[0] * 1e5) + "," + Math.round(q[1] * 1e5), adj = new Map(), pt = new Map();
      for (const [a, b] of segs) { const ka = cle(a), kb = cle(b); if (ka === kb) continue; pt.set(ka, a); pt.set(kb, b); (adj.get(ka) || adj.set(ka, []).get(ka)).push(kb); (adj.get(kb) || adj.set(kb, []).get(kb)).push(ka); }
      const vus = new Set(), boucles = [];
      for (const dep of adj.keys()) {
        if (vus.has(dep) || adj.get(dep).length !== 2) continue;
        const B = [dep]; vus.add(dep); let prec = null, cur = dep, ok = true;
        for (let g = 0; g < 200000; g++) { const nx = adj.get(cur); if (!nx || nx.length !== 2) { ok = false; break; } const s2 = nx[0] !== prec ? nx[0] : nx[1]; if (s2 === dep) break; if (vus.has(s2)) { ok = false; break; } B.push(s2); vus.add(s2); prec = cur; cur = s2; }
        if (ok && B.length >= 3) boucles.push(B.map((x) => pt.get(x)));
      }
      if (!boucles.length) continue;
      const aire = (Q) => { let a = 0; Q.forEach((q, i) => { const r = Q[(i + 1) % Q.length]; a += q[0] * r[1] - r[0] * q[1]; }); return Math.abs(a) / 2; };
      const dans = (q, Q) => { let c = false; for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) { const a = Q[i], b = Q[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
      const A = boucles.map(aire), parent = boucles.map((Q, i) => { let best = -1; boucles.forEach((R, j) => { if (j !== i && A[j] > A[i] && dans(Q[0], R) && (best < 0 || A[j] < A[best])) best = j; }); return best; });
      const prof = (i) => { let c = 0, x = parent[i]; while (x >= 0 && c < 50) { c++; x = parent[x]; } return c; };
      const base = couleurDe(p, m).rgb, col = base.map((x) => x * 0.42 + 0.05);
      const vers3 = (q) => { const r = [0, 0, 0]; r[k] = v; r[i1] = q[0]; r[i2] = q[1]; return r; };
      boucles.forEach((B, i) => {
        if (prof(i) % 2) return;
        for (const t of IFC.triangulate(B, boucles.filter((_, j) => parent[j] === i))) tri(vers3(t[0]), vers3(t[1]), vers3(t[2]), col);
      });
      for (const B of boucles) B.forEach((q, i) => arete(vers3(q), vers3(B[(i + 1) % B.length])));
    }
  }
  function pourAretes(p, f) {
    const zc = etat.coupe;
    for (const m of p.morceaux) {
      if (m.verre) continue;
      const A = m.A, o = m.o;
      for (let i = 0; i < A.length; i += 6) {
        let a = [A[i] + o[0], A[i + 1] + o[1], A[i + 2] + o[2]], b = [A[i + 3] + o[0], A[i + 4] + o[1], A[i + 5] + o[2]];
        if (zc) { const k = AXE[zc.axe], v = zc.v; if (a[k] > v && b[k] > v) continue; if (a[k] > v || b[k] > v) { const t = (v - a[k]) / (b[k] - a[k]); const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]; q[k] = v; if (a[k] > v) a = q; else b = q; } }
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6) continue;
        f(a, b);
      }
    }
  }
  const rgba = (c, k, a) => `rgba(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)},${a})`;

  function visible(pi) {
    const p = M.produits[pi];
    if (etat.isole && !etat.isole.has(pi)) return false;
    if (p.cmp && etat.cmp) { if (p.cmp === "identique" ? !etat.cmp.fond : !etat.cmp.vis.has(p.cmp)) return false; }
    if (etat.caches.has(p.type)) return false;
    if (p.etage != null && etat.cache.has(p.etage)) return false;
    return true;
  }

  // ---------- Dessin WebGL (tampon de profondeur : chaque face cache correctement celles de derriere) ----------
  const gl = cv.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false });
  const cal = $("#calque"), c2 = cal.getContext("2d");
  const VS = `attribute vec3 pos; attribute vec4 col; uniform vec3 eye, ar, au, af; uniform vec4 proj; uniform float ortho; varying vec4 vcol;
    void main(){ vec3 d = pos - eye; float x = dot(d, ar), y = dot(d, au), z = dot(d, af);
      if (ortho > 0.5) gl_Position = vec4(x * proj.x, y * proj.y, (z - proj.z) / proj.w * 2.0 - 1.0, 1.0);
      else gl_Position = vec4(x * proj.x, y * proj.y, z * (proj.w + proj.z) / (proj.w - proj.z) - 2.0 * proj.w * proj.z / (proj.w - proj.z), z);
      vcol = col; }`;
  const FS = `precision mediump float; varying vec4 vcol; void main(){ gl_FragColor = vcol; }`;
  function shader(t, src) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  const prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const loc = { pos: gl.getAttribLocation(prog, "pos"), col: gl.getAttribLocation(prog, "col") };
  const uni = Object.fromEntries(["eye", "ar", "au", "af", "proj", "ortho"].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const lots = {}; // opaque, verre, aretes, aretesSel
  function lot(nom, pos, col, n, mode) {
    const L = lots[nom] || (lots[nom] = { bp: gl.createBuffer(), bc: gl.createBuffer() });
    gl.bindBuffer(gl.ARRAY_BUFFER, L.bp); gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, n * 3), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.bc); gl.bufferData(gl.ARRAY_BUFFER, col.subarray(0, n * 4), gl.STATIC_DRAW);
    L.n = n; L.mode = mode;
  }
  const hexRgb = (h) => { const m = h.match(/rgba?\(([^)]+)\)/); if (m) { const v = m[1].split(",").map(Number); return [v[0] / 255, v[1] / 255, v[2] / 255, v[3] ?? 1]; } const x = h.replace("#", ""); return [parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255, 1]; };
  // tampon extensible : positions Float32 (relatives a O) + couleurs sur 4 octets
  function tampon(n) {
    const t = { p: new Float32Array(Math.max(n, 1) * 3), c: new Uint8Array(Math.max(n, 1) * 4), n: 0 };
    t.ajout = (q, r, g, b, a) => {
      if (t.n * 3 + 3 > t.p.length) { const p2 = new Float32Array(t.p.length * 2), c2 = new Uint8Array(t.c.length * 2); p2.set(t.p); c2.set(t.c); t.p = p2; t.c = c2; }
      const o = t.n * 3, c = t.n * 4; t.p[o] = q[0] - O[0]; t.p[o + 1] = q[1] - O[1]; t.p[o + 2] = q[2] - O[2]; t.c[c] = r; t.c[c + 1] = g; t.c[c + 2] = b; t.c[c + 3] = a; t.n++;
    };
    return t;
  }
  const ARETE = [0.27, 0.28, 0.3, 1]; // gris fonce : lisible sans noircir la maquette
  const ombre = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); return l > 0 ? 0.62 + 0.38 * Math.abs((nx * LUM[0] + ny * LUM[1] + nz * LUM[2]) / l) : -1; };
  // Tout redessiner seulement si la visibilite, la coupe ou le theme changent ; la selection a son propre calque (instantane)
  function envoyer() {
    if (!M) return;
    const vis = M.produits.map((_, i) => visible(i));
    const arete = ARETE, sig = vis.map((x) => (x ? 1 : 0)).join("") + JSON.stringify(etat.coupe);
    if (sig !== sigPrec) {
      sigPrec = sig;
      let nt = 0, nl = 0; M.produits.forEach((p, i) => { if (vis[i]) for (const m of p.morceaux) { nt += m.T.length / 9; nl += m.A.length / 6; } });
      const op = tampon(nt * 3), ve = tampon(64), ar = tampon(nl * 2);
      const ea = [arete[0] * 255, arete[1] * 255, arete[2] * 255, arete[3] * 255].map(Math.round);
      M.produits.forEach((p, pi) => {
        if (!vis[pi]) return;
        let mc = null, col = null;
        pourTriangles(p, (a, b, c, m) => {
          if (m !== mc) { mc = m; col = couleurDe(p, m); }
          const sh = ombre(a, b, c); if (sh < 0) return;
          const d = col.a < 1 ? ve : op, r = Math.round(Math.min(1, col.rgb[0] * sh) * 255), g = Math.round(Math.min(1, col.rgb[1] * sh) * 255), bl = Math.round(Math.min(1, col.rgb[2] * sh) * 255), al = Math.round(col.a * 255);
          d.ajout(a, r, g, bl, al); d.ajout(b, r, g, bl, al); d.ajout(c, r, g, bl, al);
        });
        pourAretes(p, (a, b) => { ar.ajout(a, ea[0], ea[1], ea[2], ea[3]); ar.ajout(b, ea[0], ea[1], ea[2], ea[3]); });
        // coupe : matiere coupee remplie (teinte foncee de l'element) et contour net
        if (etat.coupe) capuchons(p, (a, b, c, col) => { const r = Math.round(col[0] * 255), g = Math.round(col[1] * 255), bl = Math.round(col[2] * 255); op.ajout(a, r, g, bl, 255); op.ajout(b, r, g, bl, 255); op.ajout(c, r, g, bl, 255); }, (a, b) => { ar.ajout(a, ea[0], ea[1], ea[2], ea[3]); ar.ajout(b, ea[0], ea[1], ea[2], ea[3]); });
      });
      lot("opaque", op.p, op.c, op.n, gl.TRIANGLES); lot("verre", ve.p, ve.c, ve.n, gl.TRIANGLES); lot("aretes", ar.p, ar.c, ar.n, gl.LINES);
    }
    // calque de la selection, dessine par-dessus
    // selection : couleur de l'appli eclaircie (remplissage) et pleine (aretes)
    const app = hexRgb(css("--app") || "#4d7c0f"), sel = app.map((x, i) => (i < 3 ? x * 0.55 + 0.45 : 1)), as = app;
    const ts = tampon(64), ls = tampon(64);
    if (etat.sel != null && vis[etat.sel]) {
      const p = M.produits[etat.sel], s8 = sel.map((x) => Math.round(x * 255)), a8 = as.map((x) => Math.round(x * 255));
      pourTriangles(p, (a, b, c) => { ts.ajout(a, s8[0], s8[1], s8[2], 255); ts.ajout(b, s8[0], s8[1], s8[2], 255); ts.ajout(c, s8[0], s8[1], s8[2], 255); });
      pourAretes(p, (a, b) => { ls.ajout(a, a8[0], a8[1], a8[2], 255); ls.ajout(b, a8[0], a8[1], a8[2], 255); });
    }
    lot("sel", ts.p, ts.c, ts.n, gl.TRIANGLES); lot("aretesSel", ls.p, ls.c, ls.n, gl.LINES);
    redessiner();
  }
  let demande = false;
  const redessiner = () => { if (!demande) { demande = true; requestAnimationFrame(dessiner); } };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function dessiner() {
    demande = false;
    c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, W, H);
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!M) return;
    const R = repere();
    // plage de profondeur d'apres la taille de la maquette
    const bb = M.bbTout, c = bb.min.map((v, i) => (v + bb.max[i]) / 2), rad0 = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / 2, rad = rad0 + Math.max(1e-4, Math.min(1, rad0 * 0.05));
    const dc = dt([c[0] - R.e[0], c[1] - R.e[1], c[2] - R.e[2]], R.f);
    let zn = dc - rad * 1.5, zf = dc + rad * 1.5;
    if (!cam.ortho) zn = Math.max(Math.min(0.05, rad0 * 1e-3), zn, zf / 2000);
    gl.uniform3fv(uni.eye, [R.e[0] - O[0], R.e[1] - O[1], R.e[2] - O[2]]); gl.uniform3fv(uni.ar, R.r); gl.uniform3fv(uni.au, R.u); gl.uniform3fv(uni.af, R.f);
    gl.uniform1f(uni.ortho, cam.ortho ? 1 : 0);
    gl.uniform4f(uni.proj, cam.ortho ? cam.ech * 2 / W : 2 * R.F / W, cam.ortho ? cam.ech * 2 / H : 2 * R.F / H, zn, cam.ortho ? zf - zn : zf);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const tracer = (L) => { if (!L || !L.n) return; gl.bindBuffer(gl.ARRAY_BUFFER, L.bp); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ARRAY_BUFFER, L.bc); gl.enableVertexAttribArray(loc.col); gl.vertexAttribPointer(loc.col, 4, gl.UNSIGNED_BYTE, true, 0, 0); gl.drawArrays(L.mode, 0, L.n); };
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
    gl.disable(gl.BLEND); gl.depthMask(true); tracer(lots.opaque);
    gl.polygonOffset(0, 0); tracer(lots.sel);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    tracer(lots.aretes); tracer(lots.aretesSel);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); tracer(lots.verre); gl.depthMask(true);
    dessinerMesure(R);
    dessinerBoussole(R);
  }
  function versEcran(p, R) {
    const d = [p[0] - R.e[0], p[1] - R.e[1], p[2] - R.e[2]];
    const x = dt(d, R.r), y = dt(d, R.u), z = Math.max(dt(d, R.f), 0.02);
    return cam.ortho ? [W / 2 + x * cam.ech, H / 2 - y * cam.ech] : [W / 2 + (x / z) * R.F, H / 2 - (y / z) * R.F];
  }
  function dessinerMesure(R) {
    if (!etat.pts.length) return;
    const acc = css("--app");
    const P = etat.pts.map((p) => versEcran(p, R));
    c2.save();
    if (P.length === 2) { c2.strokeStyle = acc; c2.lineWidth = 2; c2.setLineDash([6, 4]); c2.beginPath(); c2.moveTo(P[0][0], P[0][1]); c2.lineTo(P[1][0], P[1][1]); c2.stroke(); c2.setLineDash([]); }
    for (const q of P) { c2.fillStyle = css("--surface"); c2.strokeStyle = acc; c2.lineWidth = 2; c2.beginPath(); c2.arc(q[0], q[1], 5, 0, 7); c2.fill(); c2.stroke(); }
    if (P.length === 2) {
      const d = dist3(etat.pts[0], etat.pts[1]);
      const txt = `${mm(d)} mm`; c2.font = "600 13px 'IBM Plex Mono', ui-monospace, monospace";
      const w = c2.measureText(txt).width + 16, mx = (P[0][0] + P[1][0]) / 2, my = (P[0][1] + P[1][1]) / 2 - 18;
      c2.fillStyle = acc; roundRect(mx - w / 2, my - 12, w, 24, 6); c2.fill();
      c2.fillStyle = css("--on-app"); c2.textAlign = "center"; c2.textBaseline = "middle"; c2.fillText(txt, mx, my + 1);
    }
    c2.restore();
  }
  function roundRect(x, y, w, h, r) { c2.beginPath(); c2.moveTo(x + r, y); c2.arcTo(x + w, y, x + w, y + h, r); c2.arcTo(x + w, y + h, x, y + h, r); c2.arcTo(x, y + h, x, y, r); c2.arcTo(x, y, x + w, y, r); c2.closePath(); }
  function dessinerBoussole(R) {
    // petit repere X / Y / Z en bas a gauche
    const o = [42, H - 42], L = 24;
    c2.save(); c2.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace"; c2.textAlign = "center"; c2.textBaseline = "middle";
    for (const [ax, nom, c] of [[[1, 0, 0], "X", "--ax-x"], [[0, 1, 0], "Y", "--ax-y"], [[0, 0, 1], "Z", "--ax-z"]]) {
      const x = dt(ax, R.r), y = dt(ax, R.u);
      c2.strokeStyle = css(c); c2.lineWidth = 2; c2.beginPath(); c2.moveTo(o[0], o[1]); c2.lineTo(o[0] + x * L, o[1] - y * L); c2.stroke();
      c2.fillStyle = css(c); c2.fillText(nom, o[0] + x * (L + 9), o[1] - y * (L + 9));
    }
    c2.restore();
  }
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // ---------- Selection a la souris (lancer de rayon) ----------
  function rayon(px, py) {
    const R = repere();
    if (cam.ortho) { const o = [0, 1, 2].map((i) => R.e[i] + R.r[i] * (px - W / 2) / cam.ech - R.u[i] * (py - H / 2) / cam.ech); return { o, d: R.f, R }; }
    return { o: R.e, d: nrm([0, 1, 2].map((i) => R.f[i] + R.r[i] * (px - W / 2) / R.F - R.u[i] * (py - H / 2) / R.F)), R };
  }
  function viser(px, py) {
    const { o, d, R } = rayon(px, py); let best = null, bt = Infinity;
    const zc = etat.coupe, kz = zc ? AXE[zc.axe] : 0;
    M.produits.forEach((p, pi) => {
      if (!visible(pi)) return;
      // test rapide sur la boite de l'element
      const bb = p.bb; let t0 = 0, t1 = Infinity;
      for (let k = 0; k < 3; k++) { if (Math.abs(d[k]) < 1e-12) { if (o[k] < bb.min[k] - 1e-6 || o[k] > bb.max[k] + 1e-6) return; continue; } let ta = (bb.min[k] - 1e-6 - o[k]) / d[k], tb = (bb.max[k] + 1e-6 - o[k]) / d[k]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return; }
      if (t0 > bt) return;
      for (const m of p.morceaux) {
        const T = m.T, mo = m.o;
        for (let i = 0; i < T.length; i += 9) {
          const a = [T[i] + mo[0], T[i + 1] + mo[1], T[i + 2] + mo[2]], b = [T[i + 3] + mo[0], T[i + 4] + mo[1], T[i + 5] + mo[2]], c = [T[i + 6] + mo[0], T[i + 7] + mo[1], T[i + 8] + mo[2]];
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const pv = crs(d, e2), det = dt(e1, pv); if (Math.abs(det) < 1e-12) continue;
          const tv = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = dt(tv, pv) / det; if (u < 0 || u > 1) continue;
          const q = crs(tv, e1), w = dt(d, q) / det; if (w < 0 || u + w > 1) continue;
          const s = dt(e2, q) / det; if (!(s > 1e-4 && s < bt)) continue;
          if (zc && o[kz] + d[kz] * s > zc.v + 1e-6) continue; // partie enlevee par la coupe
          bt = s; best = { t: { p: pi }, a, b, c };
        }
      }
    });
    if (!best) return null;
    let p = [o[0] + d[0] * bt, o[1] + d[1] * bt, o[2] + d[2] * bt];
    // accroche au sommet le plus proche (12 px)
    let snap = null, sd = 12;
    for (const q of [best.a, best.b, best.c]) { const s = versEcran(q, R); const dd = Math.hypot(s[0] - px, s[1] - py); if (dd < sd) { sd = dd; snap = q; } }
    if (snap) p = snap;
    // normale de la face visee, tournee vers l'observateur (= vers l'exterieur de la piece)
    const nf = nrm(crs([best.b[0] - best.a[0], best.b[1] - best.a[1], best.b[2] - best.a[2]], [best.c[0] - best.a[0], best.c[1] - best.a[1], best.c[2] - best.a[2]])), n = dt(nf, d) > 0 ? nf.map((x) => -x) : nf;
    return { pi: best.t.p, p, accroche: !!snap, n };
  }

  // ---------- Vues ----------
  function boiteVisible() {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const vis = M.produits.filter((_, i) => visible(i));
    // cadrage robuste : les elements isoles tres loin du batiment (reperes, terrain...) ne rapetissent pas la vue
    let garde = () => true;
    if (vis.length > 30) {
      const q = [0, 1, 2].map((k) => { const c = vis.map((p) => (p.bb.min[k] + p.bb.max[k]) / 2).sort((a, b) => a - b), a = c[Math.floor(c.length * 0.02)], b = c[Math.floor(c.length * 0.98)], r = b - a; return [a - 0.3 * r - 2, b + 0.3 * r + 2]; });
      garde = (p) => [0, 1, 2].every((k) => { const c = (p.bb.min[k] + p.bb.max[k]) / 2; return c >= q[k][0] && c <= q[k][1]; });
    }
    for (const p of vis) { if (!garde(p)) continue; for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.bb.min[k]); max[k] = Math.max(max[k], p.bb.max[k]); } }
    if (!isFinite(min[0])) { min = [0, 0, 0]; max = [1, 1, 1]; }
    if (etat.coupe) { const k = AXE[etat.coupe.axe]; max[k] = Math.min(max[k], etat.coupe.v); }
    return { min, max };
  }
  function cadrer(bb = boiteVisible()) {
    cam.cible = bb.min.map((v, i) => (v + bb.max[i]) / 2);
    const R = Math.max(1e-3, Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / 2); // pas de plancher a 0,5 m : une petite piece STEP remplit l'ecran
    cam.dist = R / Math.sin(cam.fov / 2) * 1.05;
    cam.ech = Math.min(W, H) / (2 * R * 1.08);
    redessiner();
  }
  const VUES = {
    "3d": { th: -0.95, ph: 0.42, ortho: false }, dessous: { th: -Math.PI / 2, ph: -1.55, ortho: true }, plan: { th: -Math.PI / 2, ph: 1.5697, ortho: true },
    a: { th: -Math.PI / 2, ph: 0, ortho: true }, b: { th: 0, ph: 0, ortho: true }, c: { th: Math.PI / 2, ph: 0, ortho: true }, d: { th: Math.PI, ph: 0, ortho: true },
  };
  let ANGLE = 0; // orientation principale du batiment (les faces A a D la suivent)
  function vue(nom) {
    Object.assign(cam, VUES[nom]);
    if ("abcd".includes(nom) && nom.length === 1) cam.th += ANGLE;
    etat.face = "abcd".includes(nom) && nom.length === 1 ? nom : null; etat.vue2d = nom === "3d" ? null : nom; majDxf();
    document.querySelectorAll("[data-vue]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vue === nom)));
    cadrer();
  }

  // ---------- Interactions ----------
  let drag = null; const ptrs = new Map();
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    drag = { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, pan: e.button === 2 || e.shiftKey || ptrs.size > 1, bouge: false, pinch: ptrs.size === 2 ? pinchDist() : null };
  });
  const pinchDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  cv.addEventListener("pointermove", (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (!drag) { survoler(e.offsetX, e.offsetY); return; }
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.hypot(e.offsetX - drag.x0, e.offsetY - drag.y0) > 4) drag.bouge = true;
    drag.x = e.offsetX; drag.y = e.offsetY;
    if (ptrs.size === 2 && drag.pinch) { const d = pinchDist(); zoom(drag.pinch / d, W / 2, H / 2); drag.pinch = d; return; }
    if (drag.pan) {
      const R = repere(); const s = cam.ortho ? 1 / cam.ech : cam.dist / R.F;
      for (let i = 0; i < 3; i++) cam.cible[i] += (-R.r[i] * dx + R.u[i] * dy) * s;
    } else {
      cam.th -= dx * 0.008; cam.ph = Math.max(-1.55, Math.min(1.5697, cam.ph + dy * 0.008));
      if (cam.ortho && !document.querySelector('[data-vue="plan"][aria-pressed="true"]')) { etat.face = null; etat.vue2d = null; majDxf(); cam.ortho = false; document.querySelectorAll("[data-vue]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vue === "3d"))); }
    }
    redessiner();
  });
  const fin = (e) => {
    ptrs.delete(e.pointerId);
    if (drag && !drag.bouge && ptrs.size === 0 && e.type === "pointerup") cliquer(e.offsetX, e.offsetY);
    if (ptrs.size === 0) drag = null;
  };
  cv.addEventListener("pointerup", fin); cv.addEventListener("pointercancel", fin);
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012), e.offsetX, e.offsetY); }, { passive: false });
  cv.addEventListener("dblclick", () => { if (etat.sel != null) cadrerSur(etat.sel); });
  function zoom(f, px, py) {
    const avant = rayon(px, py);
    // limites de zoom relatives a la taille du modele : on peut s'approcher jusqu'a ~0,3 % de sa taille, d'une piece de quelques mm a un batiment
    const S = M ? Math.max(1e-3, Math.hypot(M.bbTout.max[0] - M.bbTout.min[0], M.bbTout.max[1] - M.bbTout.min[1], M.bbTout.max[2] - M.bbTout.min[2]) / 2) : 1;
    if (cam.ortho) cam.ech = Math.max(2, Math.min(Math.max(5000, Math.min(W, H) / (0.006 * S)), cam.ech / f)); else cam.dist = Math.max(Math.min(0.3, 0.003 * S), Math.min(Math.max(500, 50 * S), cam.dist * f));
    // garde le point sous le curseur a peu pres en place (vue a plat)
    if (cam.ortho) { const apres = rayon(px, py); for (let i = 0; i < 3; i++) cam.cible[i] += avant.o[i] - apres.o[i]; }
    redessiner();
  }
  let survolT = 0;
  function survoler(x, y) {
    if (!M) return;
    const now = performance.now(); if (now - survolT < 60 || etat.mesure) return; survolT = now;
    const h = viser(x, y); const bulle = $("#bulle");
    if (!h) { bulle.hidden = true; cv.style.cursor = ""; return; }
    const p = M.produits[h.pi]; bulle.textContent = `${p.nom} · ${p.type}`; bulle.hidden = false;
    bulle.style.left = `${Math.min(x + 14, W - bulle.offsetWidth - 8)}px`; bulle.style.top = `${y + 14}px`; cv.style.cursor = "pointer";
  }
  cv.addEventListener("pointerleave", () => { $("#bulle").hidden = true; });
  function cliquer(x, y) {
    if (!M) return;
    const h = viser(x, y);
    if (etat.poser) { if (!h) return; basculerPoser(false); appliquerOrientation(IFC.matricePoser(h.n)); toast("Face posée en dessous. Vous pouvez affiner avec les rotations."); return; }
    if (etat.mesure) {
      if (!h) return;
      if (etat.pts.length >= 2) etat.pts = [];
      etat.pts.push(h.p); afficherMesure(); redessiner(); return;
    }
    choisir(h ? h.pi : null);
  }
  function cadrerSur(pi) { const p = M.produits[pi]; cadrer({ min: p.bb.min.map((v) => v - 0.3), max: p.bb.max.map((v) => v + 0.3) }); }

  // ---------- Selection et proprietes ----------
  const nomEtage = (id) => (M.etages.find((e) => e.id === id) || {}).nom || "—";
  function choisir(pi, depuisListe = false) {
    if (pi != null && !ui.fiche) { ui.fiche = true; majUi(); } // la fiche s'ouvre quand on selectionne un element
    etat.sel = pi;
    document.querySelectorAll("[data-pi]").forEach((el) => el.classList.toggle("sel", +el.dataset.pi === pi));
    if (depuisListe && pi != null) { const el = document.querySelector(`#arbre [data-pi="${pi}"]`); if (el) { el.closest("details").open = true; el.scrollIntoView({ block: "nearest" }); } }
    afficherProps(); envoyer();
  }
  function ligne(k, v, mono) { return v === "" || v == null ? "" : `<div class="kv"><dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ""}>${esc(v)}</dd></div>`; }
  function afficherProps() {
    const box = $("#props");
    if (!M) return;
    if (etat.mesure) return afficherMesure();
    if (etat.sel == null) {
      box.innerHTML = `<p class="vide">Cliquez un élément dans la vue ou dans la liste pour voir ce que la maquette contient à son sujet.</p>
        <div class="resume">${ligne("Projet", M.projet)}${ligne("Logiciel d'origine", M.logiciel)}${ligne("Format", M.schema)}${ligne(M.source === "step" ? "Pièces" : "Éléments dessinés", M.produits.length)}${ligne(M.source === "step" ? "Sous-ensembles" : "Étages", M.etages.length)}</div>
        ${M.aPsets ? "" : `<p class="note">Ce fichier ne contient pas de jeux de propriétés (Psets) : seuls les noms, matériaux et dimensions sont disponibles. Avec une maquette d'architecte bien renseignée, on verrait ici la valeur U, la résistance au feu, les références…</p>`}`;
      return;
    }
    const p = M.produits[etat.sel]; const bb = p.bb; const d = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
    const et = M.etages.find((e) => e.id === p.etage);
    const mur = p.mur != null ? M.produits.find((x) => x.id === p.mur) : null;
    let h = `<div class="tete"><span class="pastille" style="--c:${rgba((p.morceaux.find((m) => !m.verre && m.couleur) || {}).couleur?.rgb || IFC.couleurType(p.ifc), 1, 1)}"></span><div><h3>${esc(p.nom)}</h3><p>${esc(p.type)} <span class="mono">${esc(p.ifc.replace(/^IFC/, "Ifc").replace(/(Ifc)(.)(.*)/, (_m, a, b, c) => a + b + c.toLowerCase()))}</span></p></div></div>`;
    if (p.cmp) h += `<dl class="groupe cmp-fiche"><h4>Comparaison</h4><div class="stat-cmp" style="--c:${CMP[p.cmp].css}"><i></i>${CMP[p.cmp].nom}</div>${p.cmpInfo.length ? `<ul>${p.cmpInfo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="note">Aucune différence (tolérance 1 mm).</p>`}</dl>`;
    h += `<dl class="groupe"><h4>Identité</h4>${ligne(M.source === "step" ? "Sous-ensemble" : "Étage", nomEtage(p.etage))}${ligne("Matériau", p.materiau)}${ligne("Description", p.desc)}${ligne("Type d'objet", p.objType)}${ligne("GlobalId", p.gid, true)}</dl>`;
    if (p.hauteur != null) h += `<dl class="groupe"><h4>${p.ifc === "IFCDOOR" ? "Porte" : "Fenêtre"} ${CTL}</h4>${ligne("Largeur", `${p.largeur.toLocaleString("fr-CH")} mm`, true)}${ligne("Hauteur", `${p.hauteur.toLocaleString("fr-CH")} mm`, true)}${et ? ligne("Allège (depuis l'étage)", `${mm(bb.min[2] - et.z)} mm`, true) : ""}${ligne("Dans le mur", mur ? mur.nom : "—")}</dl>`;
    if (p.surf) h += `${calculMur(p)}<dl class="groupe"><h4>Surfaces du mur ${CTL}</h4>${ligne("Longueur", `${mm(p.surf.L)} mm`, true)}${ligne("Hauteur", `${mm(p.surf.h)} mm`, true)}${ligne("Épaisseur", `${mm(p.surf.T)} mm`, true)}${ligne("Surface brute", `${m2(p.surf.brute)} m²`, true)}${ligne("Ouvertures et découpes", `${p.surf.trous} (${m2(p.surf.brute - p.surf.nette)} m²)`, true)}${ligne("Surface nette", `${m2(p.surf.nette)} m²`, true)}</dl>`;
    h += `<dl class="groupe"><h4>Encombrement mesuré ${CTL}</h4>${ligne("X", `${mm(d[0])} mm`, true)}${ligne("Y", `${mm(d[1])} mm`, true)}${ligne("Z", `${mm(d[2])} mm`, true)}${ligne("Niveau bas", `${mm(bb.min[2])} mm`, true)}</dl>`;
    for (const ps of p.psets) h += `<dl class="groupe"><h4>${esc(ps.nom)}</h4>${ps.props.map((x) => ligne(x.nom, x.val)).join("")}</dl>`;
    if (!p.psets.length) h += `<p class="note">Aucun jeu de propriétés (Pset) pour cet élément dans ce fichier.</p>`;
    h += `<div class="actions"><button type="button" class="btn" id="bCadrer">Zoomer dessus</button><button type="button" class="btn" id="bIsoler">${etat.isole ? "Tout réafficher" : "Isoler"}</button></div>`;
    box.innerHTML = h;
    $("#bCadrer").onclick = () => cadrerSur(etat.sel);
    $("#bIsoler").onclick = () => { etat.isole = etat.isole ? null : new Set([etat.sel]); majOutils(); afficherProps(); envoyer(); cadrer(); };
  }
  function afficherMesure() {
    const box = $("#props");
    const [a, b] = etat.pts;
    let h = `<div class="tete"><span class="pastille regle"></span><div><h3>Mesurer</h3><p>Cliquez deux points de la maquette. Les coins sont attrapés automatiquement.</p></div></div>`;
    if (a && b) {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      h += `<div class="mesure"><span>Distance</span><b class="mono">${mm(Math.hypot(...d))} mm</b></div><dl class="groupe">${ligne("ΔX", `${mm(Math.abs(d[0]))} mm`, true)}${ligne("ΔY", `${mm(Math.abs(d[1]))} mm`, true)}${ligne("ΔZ (hauteur)", `${mm(Math.abs(d[2]))} mm`, true)}</dl><p class="note">Un nouveau clic commence une autre mesure. Échap pour quitter.</p>`;
    } else h += `<p class="vide">${a ? "Premier point posé. Cliquez le second." : "En attente du premier point."}</p>`;
    box.innerHTML = h;
  }

  // ---------- Arborescence : etages > types ----------
  function arbre() {
    const groupes = new Map();
    M.produits.forEach((p, i) => { const k = p.etage ?? "aucun"; if (!groupes.has(k)) groupes.set(k, new Map()); const g = groupes.get(k); if (!g.has(p.type)) g.set(p.type, []); g.get(p.type).push(i); });
    const ordre = [...M.etages.map((e) => e.id).filter((id) => groupes.has(id)), ...(groupes.has("aucun") ? ["aucun"] : [])];
    $("#arbre").innerHTML = ordre.map((k) => {
      const e = M.etages.find((x) => x.id === k); const g = groupes.get(k); const n = [...g.values()].reduce((s, l) => s + l.length, 0);
      return `<details class="etage" open><summary><span class="nom">${esc(e ? e.nom : M.source === "step" ? "Sans sous-ensemble" : "Sans étage")}</span><span class="cote mono">${e && !e.groupe ? `${e.elev >= 0 ? "+" : ""}${mm(e.elev)}` : ""}</span><span class="nb">${n}</span>
        ${e && !e.groupe ? `<button type="button" class="mini" data-plan="${k}" title="Vue en plan coupée à 1 m au-dessus de cet étage">Plan</button>` : ""}
        <button type="button" class="oeil" data-etage="${k}" aria-pressed="${!etat.cache.has(k)}" aria-label="Afficher ou masquer ${esc(e ? e.nom : "Sans étage")}"></button></summary>
        ${[...g.entries()].map(([t, l]) => M.source === "step"
          ? `<div class="type"><ul>${l.map((i) => `<li><button type="button" data-pi="${i}">${esc(M.produits[i].nom)}</button></li>`).join("")}</ul></div>`
          : `<details class="type"><summary><span class="nom">${esc(t)}</span><span class="nb">${l.length}</span></summary><ul>${l.map((i) => `<li><button type="button" data-pi="${i}">${esc(M.produits[i].nom)}</button></li>`).join("")}</ul></details>`).join("")}
      </details>`;
    }).join("");
    const types = [...new Set(M.produits.map((p) => p.type))].sort((a, b) => a.localeCompare(b, "fr"));
    $("#filtres").hidden = M.source === "step"; // un seul type (« Pièce ») : les pastilles ne servent a rien
    $("#filtres").innerHTML = types.map((t) => `<button type="button" class="puce" data-type="${esc(t)}" aria-pressed="${!etat.caches.has(t)}">${esc(t)} <span>${M.produits.filter((p) => p.type === t).length}</span></button>`).join("");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pi != null) { choisir(+b.dataset.pi, false); if (b.closest("#tables")) cadrerSur(+b.dataset.pi); }
    else if (b.dataset.etage != null) { e.preventDefault(); const k = b.dataset.etage === "aucun" ? "aucun" : +b.dataset.etage; etat.cache.has(k) ? etat.cache.delete(k) : etat.cache.add(k); b.setAttribute("aria-pressed", String(!etat.cache.has(k))); envoyer(); }
    else if (b.dataset.type != null) { const t = b.dataset.type; etat.caches.has(t) ? etat.caches.delete(t) : etat.caches.add(t); b.setAttribute("aria-pressed", String(!etat.caches.has(t))); envoyer(); }
    else if (b.dataset.plan != null) { e.preventDefault(); const et = M.etages.find((x) => x.id === +b.dataset.plan); poserCoupe("z", et.z + 1); vue("plan"); }
    else if (b.dataset.vue) vue(b.dataset.vue);
    else if (b.dataset.voirface) vue(b.dataset.voirface);
    else if (b.dataset.calc) { const r = $("#calc-" + b.dataset.calc), ouvert = r.hidden; r.hidden = !ouvert; b.setAttribute("aria-expanded", String(ouvert)); b.textContent = ouvert ? "Masquer le calcul" : "Voir le calcul"; if (ouvert) r.scrollIntoView({ block: "nearest" }); }
    else if (b.dataset.elev) ouvrirDxf(b.dataset.elev);
    else if (b.dataset.onglet) onglet(b.dataset.onglet);
  });

  // ---------- Outils : coupe, mesure, isoler ----------
  function bornes(axe) { const k = AXE[axe]; let a = Infinity, b = -Infinity; for (const p of M.produits) { a = Math.min(a, p.bb.min[k]); b = Math.max(b, p.bb.max[k]); } return [a, b]; }
  const NOMS_COUPE = { z: "Hauteur", x: "Position X", y: "Position Y" };
  function poserCoupe(axe, v) {
    etat.coupe = axe ? { axe, v } : null;
    $("#axeCoupe").value = axe || ""; $("#hauteur").disabled = !axe; majDxf();
    if (axe) { const [a, b] = bornes(axe); $("#hauteur").value = String(Math.round(((v - a) / (b - a)) * 1000)); $("#hauteur").setAttribute("aria-label", NOMS_COUPE[axe]); }
    majPos(); construire(); redessiner();
  }
  // Position exacte de la coupe : valeur tapee (mm, repere du modele) ou flèches ; 0,1 mm de precision
  const fmtPos = (v) => (Math.round(v * 10000) / 10).toLocaleString("fr-CH", { maximumFractionDigits: 1 });
  function majPos() {
    const c = etat.coupe, ch = $("#valCoupe");
    ch.disabled = $("#coupeMoins").disabled = $("#coupePlus").disabled = !c;
    ch.value = c ? fmtPos(c.v) : ""; ch.setAttribute("aria-label", c ? `Position exacte de la coupe ${c.axe.toUpperCase()}, en millimètres` : "Position exacte de la coupe, en millimètres");
  }
  function placerCoupe(v, signaler) {
    const c = etat.coupe; if (!c) return;
    const [a, b] = bornes(c.axe), w = Math.round(Math.min(b, Math.max(a, v)) * 10000) / 10000;
    if (signaler && w !== Math.round(v * 10000) / 10000) toast(`Hors de la maquette : ramené à ${fmtPos(w)} mm.`);
    poserCoupe(c.axe, w);
  }
  const pasCoupe = (e) => (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
  function toucheCoupe(e) {
    const c = etat.coupe; if (!c) return false;
    const s = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (e.target.id === "valCoupe" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return false; // gauche/droite deplacent le curseur de texte
    if (s) { e.preventDefault(); placerCoupe(c.v + (s * pasCoupe(e)) / 1000, false); return true; }
    if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); placerCoupe(c.v + (e.key === "PageUp" ? 0.1 : -0.1), false); return true; }
    return false;
  }
  $("#valCoupe").addEventListener("keydown", (e) => { if (!toucheCoupe(e) && e.key === "Enter") { e.preventDefault(); e.target.dispatchEvent(new Event("change")); } else if (e.key === "Escape") { majPos(); e.target.blur(); } });
  $("#valCoupe").addEventListener("change", (e) => {
    const n = parseFloat(e.target.value.replace(/[\s'’]/g, "").replace(",", "."));
    if (!isFinite(n)) { toast("Valeur non reconnue : tapez un nombre en millimètres."); majPos(); return; }
    placerCoupe(n / 1000, true);
  });
  $("#valCoupe").addEventListener("focus", (e) => e.target.select());
  $("#hauteur").addEventListener("keydown", toucheCoupe);
  for (const [id, s] of [["#coupeMoins", -1], ["#coupePlus", 1]]) $(id).addEventListener("click", (e) => { if (etat.coupe) placerCoupe(etat.coupe.v + (s * pasCoupe(e)) / 1000, false); });
  $("#axeCoupe").addEventListener("change", (e) => {
    const axe = e.target.value; if (!axe) return poserCoupe(null);
    const [a, b] = bornes(axe); poserCoupe(axe, a + (b - a) * (axe === "z" ? 0.45 : 0.5));
    // on regarde la face coupee
    if (axe === "z") vue("plan"); else { Object.assign(cam, axe === "x" ? { th: -0.55, ph: 0.25, ortho: false } : { th: Math.PI / 2 - 0.55, ph: 0.25, ortho: false }); document.querySelectorAll("[data-vue]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.vue === "3d"))); cadrer(); }
  });
  $("#hauteur").addEventListener("input", (e) => { const axe = etat.coupe && etat.coupe.axe; if (!axe) return; const [a, b] = bornes(axe); poserCoupe(axe, a + (b - a) * (+e.target.value / 1000)); });

  // ---------- Export DXF de la coupe ----------
  const dD = $("#dDxf");
  let dxfTexte = "", dxfNom = "", dxfFace = null;
  // Le bouton DXF exporte la coupe en cours, ou l'elevation de la face affichee (A a D)
  const NOMS2D = { plan: "Dessus", dessous: "Dessous", a: "Avant", b: "Droite", c: "Arrière", d: "Gauche" };
  const CLE2D = { plan: "dessus", dessous: "dessous", a: "a", b: "b", c: "c", d: "d" };
  const baseNom = () => nomFichier.replace(/\.(ifc\w*|stp|step)( \(exemple\))?$/i, "");
  function majDxf() {
    const b = $("#bDxf"), st = !!M && M.source === "step", v2 = st && etat.vue2d && NOMS2D[etat.vue2d];
    b.disabled = !M || !(etat.coupe || (st ? v2 : etat.face));
    b.title = etat.coupe ? "Exporter la coupe en DXF pour AutoCAD" : st ? (v2 ? `Exporter la vue ${NOMS2D[etat.vue2d].toLowerCase()} en DXF : arêtes, trous et cotes` : "Choisissez une vue (Dessus, Avant, Droite…) pour exporter en DXF") : etat.face ? "Exporter l'élévation cotée de cette face en DXF" : "Choisissez une coupe ou une face (A à D) pour exporter en DXF";
  }
  const ICONE_AVERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.2v.1"/></svg>';
  const CTL = '<span class="ctl" title="Valeur calculée par Maquette à partir de la géométrie : à vérifier">à contrôler</span>';
  const avertHtml = (texte) => `${ICONE_AVERT}<span><b>À contrôler.</b> ${texte}</span>`;
  let FAC = null; const facs = () => FAC || (FAC = IFC.facades(M, ANGLE));
  function ouvrirDxf(face) {
    dxfFace = face;
    const v2 = face === "2d", rel = face === "releve", nom2d = v2 ? NOMS2D[etat.vue2d] : "";
    $("#dxf-titre").textContent = rel ? "Relevé gros-œuvre en DXF" : v2 ? `Vue ${nom2d.toLowerCase()} en DXF` : face ? `Élévation DXF : ${IFC.FACES[face].nom}` : "Coupe DXF pour AutoCAD";
    $("#dxfExpl").textContent = rel ? "Un plan par niveau (murs, poteaux et escaliers coupés à 1 m au-dessus de la dalle, contour des dalles), les axes déduits avec leurs cotes, et le schéma des niveaux, en millimètres à l'échelle 1:1, rangés par calque (GO-MUR, GO-DALLE, GO-AXES…). À ouvrir dans AutoCAD comme fond de plan." : v2 ? "Le contour de chaque pièce vu dans cette direction, en millimètres à l'échelle 1:1 : arêtes visibles en trait plein, arêtes cachées en tirets, trous avec leur diamètre et leurs axes, dimensions générales. Pour un DWG : ouvrir le DXF dans AutoCAD puis « Enregistrer sous »."
      : face ? "Les murs extérieurs de cette face et leurs fenêtres et portes, vus de l'extérieur, en millimètres à l'échelle 1:1. Cotes des ouvertures par étage, dimensions de chaque ouverture, allèges et niveaux." : "Les traits coupés de chaque élément, en millimètres à l'échelle 1:1, rangés par calque (IFC-MUR, IFC-FENETRE…). Pour un DWG : ouvrir le DXF dans AutoCAD puis « Enregistrer sous ».";
    $("#lVus").hidden = !!face; $("#lCotes").hidden = !face || v2 || rel;
    for (const id of ["#lCaches", "#lGen", "#lTrous", "#lEntr"]) $(id).hidden = !v2;
    for (const id of ["#lAxes", "#lGoCotes", "#lNiv"]) $(id).hidden = !rel;
    dD.showModal();
    if (v2 || rel) { $("#dInfo").textContent = "Calcul de la vue…"; $("#dTelecharger").disabled = $("#dCopier").disabled = true; setTimeout(preparerDxf, 40); } else preparerDxf();
  }
  const relancerDxf = () => { if (dxfFace === "2d" || dxfFace === "releve") { $("#dInfo").textContent = "Calcul de la vue…"; setTimeout(preparerDxf, 40); } else preparerDxf(); };
  function preparerDxf() {
    const c = etat.coupe; if (!dxfFace && !c) return;
    const base = baseNom();
    let segs, textes = [], cercles = [], arcs = [], opt = {}, pref = "IFC", avert = "";
    if (dxfFace === "releve") {
      const Rv = IFC.releve(M, { axes: $("#dAxes").checked, cotes: $("#dGoCotes").checked, niveaux: $("#dNiv").checked });
      segs = Rv.segs; textes = Rv.textes; cercles = Rv.cercles; pref = "GO";
      avert = [...Rv.avertissements, "Cotes, hauteurs d'étage et épaisseurs de dalle sont calculées par Maquette à partir de la géométrie : comparez-les avec les plans de l'architecte avant de les utiliser (la mention figure aussi dans le fichier DXF)."].join(" ");
      dxfTexte = IFC.dxf(segs, `${nomFichier} - RELEVE GROS-OEUVRE - AXES ET COTES CALCULES PAR MAQUETTE : A CONTROLER`, textes, { prefixe: "GO", calques: IFC.CALQUES_RELEVE, cercles });
      dxfNom = `${base}-releve-gros-oeuvre.dxf`;
    } else if (dxfFace === "2d") {
      const P = IFC.projection(M, M.produits.map((_, i) => i).filter(visible), CLE2D[etat.vue2d], { caches: $("#dCaches").checked, cotes: $("#dGen").checked, trous: $("#dTrous").checked, entraxes: $("#dEntr").checked });
      segs = P.segs; textes = P.textes; cercles = P.cercles; arcs = P.arcs; pref = "STEP";
      const calc = $("#dGen").checked || $("#dTrous").checked || $("#dEntr").checked;
      if (calc) { textes = [...textes]; avert = "Les cotes, diamètres et entraxes sont calculés par Maquette à partir du maillage 3D (le fichier STEP n'est pas modifié). Comparez-les avec vos plans avant de les utiliser : la mention figure aussi dans le fichier DXF."; }
      dxfTexte = IFC.dxf(segs, `${nomFichier} - vue ${P.nom.toLowerCase()}${calc ? " - COTES CALCULEES PAR MAQUETTE : A CONTROLER" : ""}`, textes, { prefixe: "STEP", calques: IFC.CALQUES_VUE, cercles, arcs, hTitre: P.titre.h, dyTitre: P.titre.dy, ltscale: P.ltscale });
      dxfNom = `${base}-vue-${sansAccent(P.nom)}.dxf`;
    } else if (dxfFace) {
      const f = facs()[dxfFace], F = IFC.FACES[dxfFace];
      const r = IFC.elevation(M, f, $("#dCotes").checked); segs = r.segs; textes = r.textes;
      const depuis = ANGLE ? `orientation du batiment ${Math.round((ANGLE * 180) / Math.PI)} deg` : `vue depuis ${{ a: "-Y", b: "+X", c: "+Y", d: "-X" }[dxfFace]}`;
      dxfTexte = IFC.dxf(segs, `${nomFichier} - elevation ${F.nom} (${depuis})${$("#dCotes").checked ? " - COTES CALCULEES PAR MAQUETTE : A CONTROLER" : ""}`, textes);
      if ($("#dCotes").checked) avert = "Les cotes, dimensions d'ouvertures et allèges sont calculées par Maquette à partir de la géométrie du modèle. Comparez-les avec vos plans avant de les utiliser : la mention figure aussi dans le fichier DXF.";
      dxfNom = `${base}-elevation-${F.nom.toLowerCase().replace(/\s+/g, "-")}.dxf`;
    } else {
      segs = IFC.couper(M, c, visible, $("#dVus").checked);
      const quoi = c.axe === "z" ? `plan coupe a ${mm(c.v)} mm` : c.axe === "x" ? `coupe verticale x = ${mm(c.v)} mm, vue depuis +X` : `coupe verticale y = ${mm(c.v)} mm, vue depuis +Y`;
      dxfTexte = IFC.dxf(segs, `${nomFichier} - ${quoi}`);
      dxfNom = `${base}-${c.axe === "z" ? "plan" : "coupe-" + c.axe}-${Math.round(c.v * 1000)}.dxf`;
    }
    // apercu SVG
    let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    for (const s2 of segs) for (const q of [s2.a, s2.b]) { mn = [Math.min(mn[0], q[0]), Math.min(mn[1], q[1])]; mx = [Math.max(mx[0], q[0]), Math.max(mx[1], q[1])]; }
    for (const c2 of cercles) { mn = [Math.min(mn[0], c2.c[0] - c2.r), Math.min(mn[1], c2.c[1] - c2.r)]; mx = [Math.max(mx[0], c2.c[0] + c2.r), Math.max(mx[1], c2.c[1] + c2.r)]; }
    const svg = $("#apercu"), zAv = $("#dAvert"); zAv.hidden = !avert; zAv.innerHTML = avert ? avertHtml(esc(avert)) : "";
    if (!segs.length && !cercles.length) { svg.innerHTML = ""; $("#dInfo").textContent = dxfFace === "releve" ? "Rien à relever : aucun mur, poteau, dalle ni escalier." : dxfFace === "2d" ? "Rien à dessiner dans cette vue : aucune pièce visible." : dxfFace ? "Aucun mur extérieur trouvé sur cette face." : "Rien n'est coupé à cet endroit : déplacez le curseur de coupe."; $("#dTelecharger").disabled = $("#dCopier").disabled = true; return; }
    const m = dxfFace === "2d" || dxfFace === "releve" ? 0.03 * Math.max(mx[0] - mn[0], mx[1] - mn[1]) : 0.2, w = mx[0] - mn[0] + 2 * m, h = mx[1] - mn[1] + 2 * m;
    svg.setAttribute("viewBox", `${mn[0] - m} ${-mx[1] - m} ${w} ${h}`);
    const pt = (d, c2) => [c2.c[0] + c2.r * Math.cos((d * Math.PI) / 180), -(c2.c[1] + c2.r * Math.sin((d * Math.PI) / 180))];
    svg.innerHTML = [...segs.filter((s2) => s2.calque === "CACHE"), ...segs.filter((s2) => s2.calque !== "CACHE")].map((s2) => `<line class="c-${s2.calque}" x1="${s2.a[0]}" y1="${-s2.a[1]}" x2="${s2.b[0]}" y2="${-s2.b[1]}"/>`).join("")
      + cercles.map((c2) => `<circle class="c-${c2.calque}" cx="${c2.c[0]}" cy="${-c2.c[1]}" r="${c2.r}"/>`).join("")
      + arcs.map((c2) => { const [x0, y0] = pt(c2.a0, c2), [x1, y1] = pt(c2.a1, c2), span = (((c2.a1 - c2.a0) % 360) + 360) % 360; return `<path class="c-${c2.calque}" d="M${x0} ${y0} A${c2.r} ${c2.r} 0 ${span > 180 ? 1 : 0} 0 ${x1} ${y1}"/>`; }).join("")
      + textes.map((t) => `<text class="t-${t.calque}" x="${t.p[0]}" y="${-t.p[1]}" font-size="${t.h / 1000}" text-anchor="${t.centre === false ? "start" : "middle"}"${t.rot ? ` transform="rotate(${-t.rot} ${t.p[0]} ${-t.p[1]})"` : ""}>${esc(t.txt)}</text>`).join("");
    const nb = (c2) => segs.filter((s2) => s2.calque === c2).length + cercles.filter((x) => x.calque === c2).length + arcs.filter((x) => x.calque === c2).length;
    const calques = [...new Set([...segs, ...cercles, ...arcs].map((s2) => s2.calque))];
    $("#legende").innerHTML = calques.map((c2) => `<span><i class="c-${c2}"></i>${pref}-${c2} <b class="mono">${nb(c2)}</b></span>`).join("");
    $("#dInfo").textContent = `${segs.length + cercles.length + arcs.length} traits · ${mm(mx[0] - mn[0])} × ${mm(mx[1] - mn[1])} mm · unités : mm, échelle 1:1 · ${dxfNom}`;
    $("#dTelecharger").disabled = $("#dCopier").disabled = false;
  }
  $("#bReleve").addEventListener("click", () => { if (M && M.source !== "step") ouvrirDxf("releve"); });
  $("#bDxf").addEventListener("click", () => ouvrirDxf(etat.coupe ? null : M.source === "step" ? "2d" : etat.face));
  for (const id of ["#dVus", "#dCotes", "#dCaches", "#dGen", "#dTrous", "#dEntr", "#dAxes", "#dGoCotes", "#dNiv"]) $(id).addEventListener("change", relancerDxf);
  $("#dFermer").addEventListener("click", () => dD.close());
  // ---------- Export STEP ----------
  const dS = $("#dStep");
  const choixStep = () => {
    const q = (document.querySelector('#formStep input[name="quoi"]:checked') || {}).value;
    return q === "sel" && etat.sel != null ? [etat.sel] : q === "tout" ? M.produits.map((_, i) => i) : M.produits.map((_, i) => i).filter(visible);
  };
  const nbEl = (n) => `(${n} élément${n > 1 ? "s" : ""})`;
  function majStep() { const L = choixStep(); $("#sInfo").textContent = L.length ? `${L.length} pièce${L.length > 1 ? "s" : ""} à exporter` : "Rien à exporter : aucun élément affiché."; $("#sOk").disabled = !L.length; }
  $("#bStep").addEventListener("click", () => {
    if (!M) return;
    const sel = etat.sel != null ? M.produits[etat.sel] : null;
    const rSel = document.querySelector('#formStep input[value="sel"]');
    rSel.disabled = !sel; $("#sSel").textContent = sel ? `: ${sel.nom}` : "(aucun)";
    $("#sVis").textContent = nbEl(M.produits.filter((_, i) => visible(i)).length); $("#sTout").textContent = nbEl(M.produits.length);
    document.querySelector(`#formStep input[value="${sel ? "sel" : "vis"}"]`).checked = true;
    majStep(); dS.showModal();
  });
  $("#formStep").addEventListener("change", majStep);
  $("#sAnnuler").addEventListener("click", () => dS.close());
  $("#formStep").addEventListener("submit", (e) => {
    e.preventDefault();
    const L = choixStep(); if (!L.length) return;
    const base = baseNom();
    const nom = `${base}${L.length === 1 ? "-" + M.produits[L[0]].nom.replace(/[^\w.-]+/g, "_") : L.length === M.produits.length ? "" : "-selection"}.stp`;
    const r = IFC.step(M, L, { fichier: nom, nom: base });
    const url = URL.createObjectURL(new Blob([r.texte], { type: "application/step" }));
    const a = document.createElement("a"); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    dS.close(); toast(`STEP exporté : ${r.nbPieces} pièce${r.nbPieces > 1 ? "s" : ""}, ${r.nbSolides} solide${r.nbSolides > 1 ? "s" : ""}${r.nbSurfaces ? ` (+ ${r.nbSurfaces} forme${r.nbSurfaces > 1 ? "s" : ""} ouverte${r.nbSurfaces > 1 ? "s" : ""} en surfaces)` : ""}.`);
  });

  // ZIP sans compression (le cadre claude.ai n'accepte pas l'extension .dxf, mais accepte .zip)
  function zipStore(nom, texte) {
    const data = new TextEncoder().encode(texte), name = new TextEncoder().encode(nom);
    let crc = -1; for (const b of data) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); } crc = (crc ^ -1) >>> 0;
    const loc = new DataView(new ArrayBuffer(30)), cen = new DataView(new ArrayBuffer(46)), fin = new DataView(new ArrayBuffer(22));
    const t = new Date(), dt2 = ((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate(), tm = (t.getHours() << 11) | (t.getMinutes() << 5);
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(10, tm, true); loc.setUint16(12, dt2, true); loc.setUint32(14, crc, true); loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, name.length, true);
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(12, tm, true); cen.setUint16(14, dt2, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true);
    const tailleLoc = 30 + name.length + data.length;
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, 1, true); fin.setUint16(10, 1, true); fin.setUint32(12, 46 + name.length, true); fin.setUint32(16, tailleLoc, true);
    return new Blob([loc, name, data, cen, name, fin], { type: "application/zip" });
  }
  $("#dTelecharger").addEventListener("click", async () => {
    // Dans claude.ai : enregistrement via la plateforme (le visiteur confirme) ; ailleurs : telechargement classique
    const dl = window.claude && window.claude.use ? await window.claude.use("downloads").catch(() => null) : null;
    if (dl) {
      try { await dl.save({ filename: dxfNom.replace(/\.dxf$/, ".zip"), data: zipStore(dxfNom, dxfTexte) }); toast("Enregistré : ouvrez le .zip, le fichier .dxf est dedans."); }
      catch (e) { if (e && e.code !== "declined") toast("Enregistrement impossible ici : utilisez « Copier le contenu DXF »."); }
      return;
    }
    const url = URL.createObjectURL(new Blob([dxfTexte], { type: "application/dxf" }));
    const a = document.createElement("a"); a.href = url; a.download = dxfNom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  $("#dCopier").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(dxfTexte); toast("Copié : collez dans le Bloc-notes et enregistrez sous « coupe.dxf »."); }
    catch { const ta = $("#secours"); ta.hidden = false; ta.value = dxfTexte; dD.close(); ta.select(); toast("Copie bloquée : le texte est sélectionné en bas, faites Ctrl+C."); }
  });
  $("#bMesure").addEventListener("click", () => basculerMesure());
  function basculerMesure(on = !etat.mesure) { if (on) basculerPoser(false); etat.mesure = on; etat.pts = []; $("#bMesure").setAttribute("aria-pressed", String(on)); cv.classList.toggle("viseur", on); afficherProps(); redessiner(); }
  $("#bTout").addEventListener("click", () => { etat.isole = null; etat.cache.clear(); etat.caches.clear(); poserCoupe(null); arbre(); majOutils(); afficherProps(); vue("3d"); });
  function majOutils() { $("#bTout").classList.toggle("actif", !!etat.isole); }
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select") || document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") { if (etat.poser) basculerPoser(false); else if (etat.mesure) basculerMesure(false); else choisir(null); }
    if (!M || document.querySelector("dialog[open]")) return;
    if (e.key === "m" || e.key === "M") basculerMesure();
    if (e.key === "f" || e.key === "F") etat.sel != null ? cadrerSur(etat.sel) : cadrer();
  });

  // ---------- Disposition « Atelier » : rail, tiroir, fiche, listes, separateurs (memorises sur ce poste) ----------
  const appEl = document.querySelector(".app");
  const ui = { g: 280, d: 320, b: 240, gauche: "contenu", fiche: true, listes: true };
  try { Object.assign(ui, JSON.parse(localStorage.getItem("maquette-ui") || "{}")); } catch (e) { /* ignore */ }
  const LIM = { g: [200, 620], d: [260, 680], b: [120, 0.75] };
  function majUi(sauver = true) {
    // les tailles tiennent compte des panneaux replies (0 px, ou la seule barre d'onglets pour les listes)
    const st = appEl.style; st.setProperty("--g", ui.gauche ? ui.g + "px" : "0px"); st.setProperty("--sg", ui.gauche ? "8px" : "0px");
    st.setProperty("--d", ui.fiche ? ui.d + "px" : "0px"); st.setProperty("--sd", ui.fiche ? "8px" : "0px"); st.setProperty("--b", ui.listes ? ui.b + "px" : "42px");
    appEl.classList.toggle("sans-gauche", !ui.gauche); appEl.classList.toggle("sans-fiche", !ui.fiche); appEl.classList.toggle("listes-pliees", !ui.listes);
    document.querySelectorAll("[data-tiroir]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tiroir === ui.gauche)));
    document.querySelectorAll("#tiroir > [data-panneau]").forEach((p) => (p.hidden = p.dataset.panneau !== ui.gauche));
    $("#tFiche").setAttribute("aria-pressed", String(ui.fiche)); $("#tListes").setAttribute("aria-pressed", String(ui.listes));
    $("#listesPli").setAttribute("aria-expanded", String(ui.listes));
    if (sauver) try { localStorage.setItem("maquette-ui", JSON.stringify(ui)); } catch (e) { /* ignore */ }
  }
  function ouvrirTiroir(nom, basculer = true) { ui.gauche = basculer && ui.gauche === nom ? null : nom; majUi(); if (ui.gauche === "recherche") setTimeout(() => $("#qRech").focus(), 30); }
  document.querySelectorAll("[data-tiroir]").forEach((b) => b.addEventListener("click", () => ouvrirTiroir(b.dataset.tiroir)));
  $("#tFiche").addEventListener("click", () => { ui.fiche = !ui.fiche; majUi(); });
  $("#ficheFermer").addEventListener("click", () => { ui.fiche = false; majUi(); });
  $("#tListes").addEventListener("click", () => { ui.listes = !ui.listes; majUi(); });
  $("#listesPli").addEventListener("click", (e) => { e.stopPropagation(); ui.listes = !ui.listes; majUi(); });
  // un clic sur un onglet de liste repliee la deplie
  document.querySelector(".listes-tete").addEventListener("click", (e) => { if (e.target.closest("[data-onglet]") && !ui.listes) { ui.listes = true; majUi(); } });
  // separateurs : tirer pour redimensionner, double-clic pour replier / deplier, fleches au clavier
  document.querySelectorAll(".sep").forEach((sp) => {
    const k = sp.dataset.sep;
    const replier = () => { if (k === "g") ui.gauche = ui.gauche ? null : "contenu"; else if (k === "d") ui.fiche = !ui.fiche; else ui.listes = !ui.listes; majUi(); };
    const fixer = (v) => { const [mn, mx] = LIM[k]; const max = mx < 1 ? appEl.clientHeight * mx : mx; ui[k] = Math.round(Math.max(mn, Math.min(max, v))); if (k === "b") ui.listes = true; majUi(false); };
    sp.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add("actif");
      document.body.classList.add("redim"); if (k === "b") document.body.classList.add("h");
      const r = appEl.getBoundingClientRect(), tir = $("#tiroir").getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, d0 = ui.d, b0 = ui.b;
      const bouge = (ev) => { if (k === "g") fixer(ev.clientX - tir.left); else if (k === "d") fixer(d0 - (ev.clientX - x0)); else fixer(b0 - (ev.clientY - y0)); };
      const fin = () => { sp.classList.remove("actif"); document.body.classList.remove("redim", "h"); sp.removeEventListener("pointermove", bouge); sp.removeEventListener("pointerup", fin); sp.removeEventListener("pointercancel", fin); majUi(); };
      sp.addEventListener("pointermove", bouge); sp.addEventListener("pointerup", fin); sp.addEventListener("pointercancel", fin);
      void r;
    });
    sp.addEventListener("dblclick", replier);
    sp.addEventListener("keydown", (e) => {
      const pas = e.shiftKey ? 60 : 20, sens = { g: { ArrowRight: 1, ArrowLeft: -1 }, d: { ArrowLeft: 1, ArrowRight: -1 }, b: { ArrowUp: 1, ArrowDown: -1 } }[k][e.key];
      if (sens) { e.preventDefault(); fixer(ui[k] + sens * pas); majUi(); } else if (e.key === "Enter") replier();
    });
  });
  majUi(false);
  $("#tPlein").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => toast("Plein écran indisponible dans ce navigateur."));
  });
  document.addEventListener("fullscreenchange", () => $("#tPlein").setAttribute("aria-pressed", String(!!document.fullscreenElement)));

  // ---------- Recherche d'elements (nom, type, etage, materiau, GUID) ----------
  const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let indexRech = null, minuterie = 0;
  function chercher() {
    if (!M) { $("#rRech").innerHTML = `<li class="vide">Ouvrez une maquette pour chercher ses éléments.</li>`; return; }
    if (!indexRech) indexRech = M.produits.map((p) => sansAccent([p.nom, p.type, p.objType, p.materiau, p.gid, nomEtage(p.etage), p.ifc].join(" ")));
    const mots = sansAccent($("#qRech").value).split(/\s+/).filter(Boolean);
    if (!mots.length) { $("#rRech").innerHTML = `<li class="vide">Tapez quelques lettres : les éléments correspondants s'affichent ici. Plusieurs mots affinent la recherche (ex. « fenêtre E05 »).</li>`; return; }
    const res = []; for (let i = 0; i < M.produits.length && res.length < 300; i++) if (mots.every((m) => indexRech[i].includes(m))) res.push(i);
    const total = mots.length ? M.produits.reduce((n, _, i) => n + (mots.every((m) => indexRech[i].includes(m)) ? 1 : 0), 0) : 0;
    $("#rRech").innerHTML = (res.length ? res.map((i) => { const p = M.produits[i]; return `<li><button type="button" data-rpi="${i}"${etat.sel === i ? ' aria-current="true"' : ""}><b>${esc(p.nom)}</b><small>${esc(p.type)} · ${esc(nomEtage(p.etage))}</small></button></li>`; }).join("") : `<li class="vide">Aucun élément ne correspond.</li>`)
      + (total > res.length ? `<li class="info">${total.toLocaleString("fr-CH")} résultats : les 300 premiers sont affichés, précisez la recherche.</li>` : res.length ? `<li class="info">${total} résultat${total > 1 ? "s" : ""}</li>` : "");
  }
  $("#qRech").addEventListener("input", () => { clearTimeout(minuterie); minuterie = setTimeout(chercher, 120); });
  $("#qRech").addEventListener("keydown", (e) => { if (e.key === "Enter") { const b = $("#rRech [data-rpi]"); if (b) b.click(); } if (e.key === "Escape") { $("#qRech").value = ""; chercher(); } });
  $("#rRech").addEventListener("click", (e) => { const b = e.target.closest("[data-rpi]"); if (!b) return; const i = +b.dataset.rpi; choisir(i); cadrerSur(i); $("#rRech").querySelectorAll("[aria-current]").forEach((x) => x.removeAttribute("aria-current")); b.setAttribute("aria-current", "true"); });
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !e.target.matches("input, textarea, select") && !document.querySelector("dialog[open]")) { e.preventDefault(); ouvrirTiroir("recherche", false); } });

  // ---------- Listes (tableaux) et copie pour Excel ----------
  let ongletActif = "fen";
  // calcul montre pas a pas (fiche d'un mur et lignes de la liste Facades)
  const m2f = (v) => `${(Math.round(v * 100) / 100).toLocaleString("fr-CH", { minimumFractionDigits: 2 })} m²`;
  function calculMur(p) {
    const o = M.produits.filter((x) => x.mur === p.id && (x.ifc === "IFCWINDOW" || x.ifc === "IFCDOOR"));
    const lg = o.map((x) => `<li><span>${esc(x.nom)}</span><span class="mono">${x.largeur} × ${x.hauteur} mm = ${m2f(x.largeur * x.hauteur / 1e6)}</span></li>`).join("");
    return `<dl class="groupe calc"><h4>Le calcul ${CTL}</h4>
      <p class="formule"><b>${m2f(p.surf.brute)}</b> brute <i>(${(p.surf.L).toFixed(3).replace(".", ",")} m × ${(p.surf.h).toFixed(3).replace(".", ",")} m)</i><br>− <b>${m2f(p.surf.brute - p.surf.nette)}</b> de ${p.surf.trous} découpe${p.surf.trous > 1 ? "s" : ""} trouvée${p.surf.trous > 1 ? "s" : ""} dans la forme</p><div class="net"><span>Surface nette</span><b>${(Math.round(p.surf.nette * 100) / 100).toLocaleString("fr-CH", { minimumFractionDigits: 2 })}<small>m²</small></b></div>
      ${o.length ? `<p class="note">Ouvertures rattachées à ce mur dans le fichier (${o.length}) :</p><ul class="calc-liste">${lg}</ul>` : `<p class="note">Aucune fenêtre ni porte rattachée à ce mur dans le fichier.</p>`}</dl>`;
  }
  function calculFacade(cle) {
    const f = facs()[cle]; if (!f || !f.metre) return "";
    const m = f.metre, P = M.produits;
    const murs = f.murs.map((i) => { const q = P[i]; const b = q.surf ? q.surf.brute : (q.bb.max[0] - q.bb.min[0]) * (q.bb.max[2] - q.bb.min[2]); return `<li><span>${esc(q.nom)}</span><span class="mono">${m2f(b)}</span></li>`; }).join("");
    const ouv = f.ouvertures.map((o) => `<li><span>${o.porte ? "Porte" : "Fenêtre"} · ${esc(o.nom)}</span><span class="mono">${o.largeur} × ${o.hauteur} mm = ${m2f(o.largeur * o.hauteur / 1e6)}</span></li>`).join("");
    const ml = (v) => `${(Math.round(v * 100) / 100).toLocaleString("fr-CH", { minimumFractionDigits: 2 })} ml`;
    return `<div class="calc-fac"><div class="calc-col"><h5>Surface brute</h5><ul class="calc-liste">${murs}</ul><p class="tot"><span>${f.murs.length} mur${f.murs.length > 1 ? "s" : ""}</span><b class="mono">${m2f(m.brute)}</b></p></div>
      <div class="calc-col"><h5>− Ouvertures</h5>${ouv ? `<ul class="calc-liste">${ouv}</ul>` : `<p class="note">Aucune ouverture sur cette façade.</p>`}<p class="tot"><span>${m.fenetres} fenêtre${m.fenetres > 1 ? "s" : ""}, ${m.portes} porte${m.portes > 1 ? "s" : ""}</span><b class="mono">${m2f(m.ouvertures)}</b></p></div>
      <div class="calc-col res"><h5>= Surface nette</h5><p class="grand mono">${m2f(m.nette)}</p><p class="formule">${m2f(m.brute)} − ${m2f(m.ouvertures)}</p>
      <p class="note">Tableaux : 2 × hauteur de chaque ouverture = ${ml(m.tableaux)}<br>Linteaux : largeurs = ${ml(m.linteaux)}<br>Appuis : largeurs des fenêtres = ${ml(m.appuis)}</p></div></div>
      <p class="note">${CTL} Chiffres calculés par Maquette ; si un mur n'est pas percé dans le fichier, la brute et la nette ne tiennent pas compte de ses fenêtres.</p>`;
  }
  const LISTES = {
    fen: {
      titre: "Fenêtres et portes", filtre: (p) => p.ifc === "IFCWINDOW" || p.ifc === "IFCDOOR",
      cols: ["Nom", "Type", "Étage", "Mur", "Largeur (mm)", "Hauteur (mm)", "Allège (mm)", "Surface (m²)"],
      ligne: (p) => { const et = M.etages.find((e) => e.id === p.etage); const mur = M.produits.find((x) => x.id === p.mur); return [p.nom, p.type, nomEtage(p.etage), mur ? mur.nom : "—", p.largeur, p.hauteur, et ? Math.round((p.bb.min[2] - et.z) * 1000) : "", p.largeur && p.hauteur ? +(p.largeur * p.hauteur / 1e6).toFixed(2) : ""]; },
      total: (L) => ["Total", `${L.length} éléments`, "", "", "", "", "", +L.reduce((s, r) => s + (+r[7] || 0), 0).toFixed(2)],
    },
    murs: {
      titre: "Murs", filtre: (p) => !!p.surf,
      cols: ["Nom", "Étage", "Longueur (mm)", "Hauteur (mm)", "Épaisseur (mm)", "Brute (m²)", "Découpes", "Nette (m²)", "Matériau"],
      ligne: (p) => [p.nom, nomEtage(p.etage), Math.round(p.surf.L * 1000), Math.round(p.surf.h * 1000), Math.round(p.surf.T * 1000), +p.surf.brute.toFixed(2), p.surf.trous, +p.surf.nette.toFixed(2), p.materiau],
      total: (L) => ["Total", `${L.length} murs`, "", "", "", +L.reduce((s, r) => s + r[5], 0).toFixed(2), L.reduce((s, r) => s + r[6], 0), +L.reduce((s, r) => s + r[7], 0).toFixed(2), ""],
    },
    fac: {
      titre: "Façades",
      lignes: () => Object.values(facs()).filter((f) => f.metre).map((f) => { const m = f.metre, r2 = (x) => +x.toFixed(2); return { face: f.cle, r: [f.nom, f.murs.length, Math.round(m.longueur * 1000), Math.round(m.hauteur * 1000), r2(m.brute), m.fenetres, m.portes, r2(m.ouvertures), r2(m.nette), r2(m.tableaux), r2(m.linteaux), r2(m.appuis)] }; }),
      cols: ["Façade", "Murs", "Longueur (mm)", "Hauteur (mm)", "Brute (m²)", "Fenêtres", "Portes", "Ouvertures (m²)", "Nette (m²)", "Tableaux (ml)", "Linteaux (ml)", "Appuis (ml)"],
      total: (L) => { const S = (j) => +L.reduce((s2, r) => s2 + (+r[j] || 0), 0).toFixed(2); return ["Total", S(1), "", "", S(4), S(5), S(6), S(7), S(8), S(9), S(10), S(11)]; },
    },
    ecarts: {
      titre: "Écarts entre les deux versions", filtre: (p) => !!p.cmp && p.cmp !== "identique" && !!etat.cmp && etat.cmp.vis.has(p.cmp),
      tri: (a, b) => ["supprime", "ajoute", "modifie", "deplace"].indexOf(a.cmp) - ["supprime", "ajoute", "modifie", "deplace"].indexOf(b.cmp),
      cols: ["Nom", "Statut", "Type", "Étage / sous-ensemble", "Détail"],
      ligne: (p) => [p.nom, CMP[p.cmp].nom, p.type, nomEtage(p.etage), p.cmpInfo.join(" · ")],
      total: (L) => ["Total", `${L.length} écart${L.length > 1 ? "s" : ""}`, "", "", ""],
    },
    tout: {
      titre: "Tous les éléments", filtre: () => true,
      get cols() { return ["Nom", "Type", M && M.source === "step" ? "Sous-ensemble" : "Étage", "Matériau", "X (mm)", "Y (mm)", "Z (mm)"]; },
      ligne: (p) => [p.nom, p.type, nomEtage(p.etage), p.materiau, Math.round((p.bb.max[0] - p.bb.min[0]) * 1000), Math.round((p.bb.max[1] - p.bb.min[1]) * 1000), Math.round((p.bb.max[2] - p.bb.min[2]) * 1000)],
      total: (L) => ["Total", `${L.length} éléments`, "", "", "", "", ""],
    },
  };
  const fmt = (v) => (typeof v === "number" ? v.toLocaleString("fr-CH") : v ?? "");
  const AVERT_LISTE = { ecarts: "Écarts calculés par Maquette en comparant les deux fichiers (tolérance 1 mm). Un élément renommé ou recréé peut apparaître comme supprimé et ajouté.", fen: "Largeurs, hauteurs, allèges et surfaces sont calculées par Maquette à partir de la géométrie, pas lues dans le fichier.", murs: "Longueurs, hauteurs, épaisseurs et surfaces (brutes et nettes) sont calculées par Maquette à partir de la géométrie.", fac: "Façades repérées automatiquement ; longueurs, surfaces, tableaux, linteaux et appuis sont calculés par Maquette.", tout: "Les dimensions sont celles de la boîte qui englobe chaque élément, calculées par Maquette." };
  const avertListe = (k) => `<p class="avert-calc" id="avertListe">${avertHtml(`${AVERT_LISTE[k]} Vérifiez-les avant tout devis, commande ou plan.`)}</p>`;
  function onglet(k) {
    ongletActif = k;
    if (!M) return;
    document.querySelectorAll("[data-onglet]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.onglet === k)));
    const L = LISTES[k]; const lignes = [];
    const num = (c) => /\(|Découpes|^Murs$|^Fenêtres$|^Portes$/.test(c);
    if (L.lignes) {
      // facades : une ligne par face, avec un bouton pour la voir et un pour son elevation DXF
      const F = L.lignes();
      $("#tables").innerHTML = F.length ? `<table><thead><tr>${L.cols.map((c) => `<th${num(c) ? ' class="n"' : ""}>${esc(c)}</th>`).join("")}<th>Calcul</th><th>Élévation</th></tr></thead>
        <tbody>${F.map(({ face, r }) => `<tr>${r.map((v, j) => j === 0 ? `<td><button type="button" data-voirface="${face}" title="Voir cette face">${esc(v)}</button></td>` : `<td class="n mono">${esc(fmt(v))}</td>`).join("")}<td><button type="button" class="mini" data-calc="${face}" aria-expanded="false">Voir le calcul</button></td><td><button type="button" class="mini" data-elev="${face}">DXF coté</button></td></tr><tr class="ligne-calc" id="calc-${face}" hidden><td colspan="14">${calculFacade(face)}</td></tr>`).join("")}</tbody>
        <tfoot><tr>${L.total(F.map((x) => x.r)).map((v, j) => `<td${j ? ' class="n mono"' : ""}>${esc(fmt(v))}</td>`).join("")}<td></td><td></td></tr></tfoot></table>
        <p class="hint note-fac">Murs extérieurs repérés automatiquement (rien devant eux vu de chaque face). Tableaux : 2 × hauteur par ouverture ; linteaux : largeurs ; appuis : largeurs des fenêtres.</p>`
        : `<p class="vide">Aucun mur extérieur repéré dans cette maquette.</p>`;
      document.querySelectorAll("[data-onglet]").forEach((b) => { b.querySelector("span").textContent = LISTES[b.dataset.onglet].lignes ? LISTES[b.dataset.onglet].lignes().length : M.produits.filter(LISTES[b.dataset.onglet].filtre).length; });
      if (F.length) $("#tables").insertAdjacentHTML("afterbegin", avertListe(k));
      return;
    }
    M.produits.forEach((p, i) => { if (L.filtre(p)) lignes.push({ i, p, r: L.ligne(p) }); });
    if (L.tri) lignes.sort((x, y) => L.tri(x.p, y.p));
    $("#tables").innerHTML = lignes.length ? `<table><thead><tr>${L.cols.map((c) => `<th${num(c) ? ' class="n"' : ""}>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${lignes.map(({ i, r }) => `<tr${etat.sel === i ? ' class="sel"' : ""}>${r.map((v, j) => j === 0 ? `<td><button type="button" data-pi="${i}">${esc(v)}</button></td>` : `<td${num(L.cols[j]) ? ' class="n mono"' : ""}>${esc(fmt(v))}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr>${L.total(lignes.map((x) => x.r)).map((v, j) => `<td${num(L.cols[j]) ? ' class="n mono"' : ""}>${esc(fmt(v))}</td>`).join("")}</tr></tfoot></table>`
      : `<p class="vide">${L === LISTES.ecarts ? "Aucun écart avec ces filtres." : "Aucun élément de ce genre dans la maquette."}</p>`;
    document.querySelectorAll("[data-onglet]").forEach((b) => { const L2 = LISTES[b.dataset.onglet]; b.querySelector("span").textContent = L2.lignes ? L2.lignes().length : M.produits.filter(L2.filtre).length; });
    if (lignes.length) $("#tables").insertAdjacentHTML("afterbegin", avertListe(k));
  }
  $("#bCopier").addEventListener("click", async () => {
    if (!M) return;
    const L = LISTES[ongletActif]; const rows = L.lignes ? L.lignes().map((x) => x.r) : M.produits.filter(L.filtre).sort(L.tri || (() => 0)).map(L.ligne);
    const tsv = [L.cols, ...rows, L.total(rows), [`À contrôler : chiffres calculés par Maquette à partir de la géométrie du modèle (${nomFichier}).`]].map((r) => r.map((v) => String(v ?? "").replace(/\t|\n/g, " ")).join("\t")).join("\n");
    try { await navigator.clipboard.writeText(tsv); toast(`« ${L.titre} » copié : collez dans Excel (Ctrl+V).`); }
    catch { const ta = $("#secours"); ta.hidden = false; ta.value = tsv; ta.select(); toast("Copie bloquée : le tableau est sélectionné, faites Ctrl+C."); }
  });
  let toastT; function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3400); }

  // ---------- Ouvrir un fichier (lu localement, jamais envoye) ----------
  let apres = null; // si renseigne : au lieu d'afficher le prochain modele lu, on le remet a cette fonction (comparaison)
  function afficherModele(m, nom, ms) {
    if (apres) { const f = apres; apres = null; f(m, nom, ms); return; }
    if (!m.comparaison) { etat.cmp = null; $("#zoneCmp").hidden = true; }
    if (!m.produits.length) { toast("Aucun élément 3D trouvé dans ce fichier."); return; }
    M = m; nomFichier = nom;
    Object.assign(etat, { cache: new Set(), caches: new Set(), isole: null, sel: null, coupe: null, pts: [] });
    if (etat.mesure) basculerMesure(false);
    etat.poser = false; $("#oPoser").setAttribute("aria-pressed", "false"); cv.classList.remove("viseur");
    $("#axeCoupe").value = ""; $("#hauteur").disabled = true; etat.face = null; FAC = null; etat.vue2d = null; const estStep = m.source === "step"; ANGLE = estStep ? 0 : IFC.orientation(M); majDxf(); majPos();
    // fichier STEP : pas de murs ni de fenetres ; les sous-ensembles remplacent les etages ; l'export STEP n'a pas de sens
    const LIB = { plan: ["Plan", "Vue en plan (de dessus)"], a: ["A", "Élévation Face A"], b: ["B", "Élévation Face B"], c: ["C", "Élévation Face C"], d: ["D", "Élévation Face D"] };
    const LIB_STEP = { plan: ["Dessus", "Vue de dessus"], a: ["Avant", "Vue de l'avant (depuis −Y)"], b: ["Droite", "Vue de droite (depuis +X)"], c: ["Arrière", "Vue de l'arrière (depuis +Y)"], d: ["Gauche", "Vue de gauche (depuis −X)"], dessous: ["Dessous", "Vue de dessous"] };
    document.querySelectorAll("[data-vue]").forEach((b) => { const k = b.dataset.vue; if (k === "3d") return; const l = (estStep ? LIB_STEP : LIB)[k]; b.hidden = !l; if (l) { b.textContent = l[0]; b.title = l[1]; } });
    document.querySelectorAll('[data-onglet="fen"], [data-onglet="murs"], [data-onglet="fac"]').forEach((b) => { b.hidden = estStep || !!m.comparaison; });
    $('[data-onglet="ecarts"]').hidden = !m.comparaison;
    if (m.comparaison) ongletActif = "ecarts"; else if (estStep) ongletActif = "tout"; else if (ongletActif === "tout" || ongletActif === "ecarts") ongletActif = "fen";
    $("#bCompare").disabled = false; $("#bReleve").hidden = estStep || !!m.comparaison; $("#bReleve").disabled = false;
    $("#bOrienter").hidden = !estStep || !!m.comparaison; $("#panOrient").hidden = true; $("#bOrienter").setAttribute("aria-expanded", "false"); majOrient();
    $("#bStep").title = estStep ? "Cette maquette est déjà un fichier STEP" : "Exporter des éléments en STEP pour AutoCAD ou un logiciel 3D";
    $("#accueil").hidden = true; $("#bCopier").disabled = false; $("#bStep").disabled = estStep;
    construire(); arbre(); onglet(ongletActif); afficherProps(); majOutils();
    $("#fichier").textContent = nom; document.title = `${nom} — Maquette`;
    $("#infos").textContent = `${m.schema}${m.logiciel ? ` · ${m.logiciel}` : ""} · ${m.produits.length} ${estStep ? "pièces" : "éléments"} · lu en ${ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`}`;
    // remarques : badge sur le rail, detail dans le panneau « Remarques » (textes complets, sans coupure)
    const groupes = new Map();
    for (const a of m.avertissements) { const t = /^Ouvertures/.test(a) ? "Ouvertures non découpées" : /^Découpes/.test(a) ? "Découpes de forme ignorées" : /^Élément long/.test(a) ? "Éléments longs à calculer" : /^Élément ignoré/.test(a) ? "Éléments ignorés (calcul bloqué)" : /^Arêtes/.test(a) ? "Arêtes non tracées" : "Formes non dessinées"; if (!groupes.has(t)) groupes.set(t, []); groupes.get(t).push(a); }
    const EXPL = { "Ouvertures non découpées": "Certaines fenêtres ou trémies n'ont pas pu être percées dans leur mur ou leur dalle (forme trop complexe ou trop longue à calculer) : l'élément est affiché plein.", "Découpes de forme ignorées": "Certains éléments sont coupés dans la maquette par une forme particulière : ils sont affichés avant la découpe.", "Éléments longs à calculer": "Ces éléments ont pris plusieurs secondes : c'est eux qui allongent la lecture.", "Éléments ignorés (calcul bloqué)": "Le calcul de ces éléments bloquait la lecture : ils ne sont pas affichés.", "Arêtes non tracées": "Ce fichier est très lourd : les faces sont dessinées, mais les traits d'arête ne le sont pas.", "Formes non dessinées": "Quelques types de formes ne sont pas encore pris en charge." };
    const CQ = IFC.controle(M); const nbRq = groupes.size + CQ.length; $("#nbRem").hidden = !nbRq; $("#nbRem").textContent = nbRq;
    $("#remarques").innerHTML = groupes.size ? [...groupes].map(([t, L]) => `<div class="rq"><b>${esc(t)}</b><p>${esc(EXPL[t])}</p>${L.some((x) => /#|:/.test(x)) ? `<ul>${L.filter((x) => /:/.test(x)).map((x) => `<li>${esc(x.replace(/^[^:]+:\s*/, ""))}</li>`).join("")}</ul>` : ""}</div>`).join("") : "";
    $("#remarques").innerHTML += CQ.map((g) => `<div class="rq cq"><b>Contrôle · ${esc(g.titre)} <span class="n-cq">${g.items.length}</span></b><p>${esc(g.expl)}</p><ul>${g.items.slice(0, 40).map((it) => `<li><button type="button" data-pi="${it.i}">${esc(it.texte)}</button></li>`).join("")}${g.items.length > 40 ? `<li>… et ${g.items.length - 40} autres</li>` : ""}</ul></div>`).join("");
    if (!nbRq) $("#remarques").innerHTML = `<p class="vide">Aucune remarque : tout a été lu et dessiné, et le contrôle du modèle n'a rien relevé.</p>`;
    indexRech = null; if (ui.gauche === "recherche") chercher();
    dimensionner(); vue("3d");
  }
  // Lecture dans un travailleur en arriere-plan (la page reste fluide) ; a defaut, directement
  // source : texte IFC (exemple) ou fichier choisi (.ifc / .ifczip, lu et decompresse dans le worker)
  function lire(texte, nom, ignorer = []) {
    const t0 = performance.now();
    $("#chargement").hidden = false; $("#chargementTxt").textContent = `Lecture de ${nom}…`;
    let veille = null;
    const fin = () => { $("#chargement").hidden = true; clearInterval(veille); };
    const direct = () => setTimeout(async () => {
      try { afficherModele(IFC.build(typeof texte === "string" ? texte : await IFC.texteIFC(texte), null, { ignorer }), nom, performance.now() - t0); } catch (err) { toast(`Impossible de lire ce fichier : ${err.message}`); }
      fin();
    }, 30);
    let w;
    try { w = new Worker(new URL("./worker.js?v=1.17", import.meta.url), { type: "module" }); } catch (e) { direct(); return; }
    let dernier = null, attente = false, tDernier = Date.now();
    // garde-fou : un element dont le calcul bloque plus de 30 s est ignore, et la lecture repart sans lui
    veille = setInterval(() => {
      const id = dernier && /#(\d+)/.exec(dernier.etape || "");
      if (!id || Date.now() - tDernier < 30000) return;
      w.terminate(); clearInterval(veille);
      if (ignorer.length >= 5) { fin(); toast("Lecture abandonnée : trop d'éléments bloquent le calcul dans ce fichier."); return; }
      toast(`Un élément bloquait la lecture (#${id[1]}) : il est ignoré, la lecture reprend.`);
      lire(texte, nom, [...ignorer, +id[1]]);
    }, 2000);
    w.onmessage = (e) => {
      if (e.data.prog != null) {
        dernier = e.data; tDernier = Date.now();
        if (!attente) { attente = true; requestAnimationFrame(() => { attente = false; const et = dernier.etape || "Lecture"; $("#chargementTxt").textContent = `${nom} · ${et}${dernier.prog > 0 ? ` · ${Math.round(dernier.prog * 100)} %` : "…"}`; }); }
        return;
      }
      w.terminate(); fin(); if (e.data.ok) afficherModele(e.data.m, nom, performance.now() - t0); else toast(`Impossible de lire ce fichier : ${e.data.err}`);
    };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); clearInterval(veille); direct(); };
    w.postMessage({ src: texte, ignorer });
  }
  // Fichier STEP : lu par OpenCascade dans une boite sans reseau (step.js), puis converti en modele dans le worker habituel
  async function lireStepFichier(f) {
    const nom = f.name, t0 = performance.now();
    $("#chargement").hidden = false; $("#chargementTxt").textContent = `Lecture de ${nom}…`;
    const fin = () => { $("#chargement").hidden = true; };
    let res;
    try {
      const { lireStep } = await import("./step.js?v=1.17");
      res = await lireStep(f, (t) => { $("#chargementTxt").textContent = `${nom} · ${t}…`; });
    } catch (err) { fin(); toast(`Impossible de lire ce fichier STEP : ${err.message}`); return; }
    $("#chargementTxt").textContent = `${nom} · Conversion de la géométrie…`;
    const direct = () => setTimeout(() => { try { afficherModele(IFC.depuisStep(res, { nom }), nom, performance.now() - t0); } catch (err) { toast(`Impossible de lire ce fichier STEP : ${err.message}`); } fin(); }, 30);
    let w; try { w = new Worker(new URL("./worker.js?v=1.17", import.meta.url), { type: "module" }); } catch (e) { direct(); return; }
    w.onmessage = (e) => { if (e.data.prog != null) return; w.terminate(); fin(); if (e.data.ok) afficherModele(e.data.m, nom, performance.now() - t0); else toast(`Impossible de lire ce fichier STEP : ${e.data.err}`); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); fin(); toast("Impossible de convertir ce fichier STEP (le calcul en arrière-plan a échoué)."); }; // les tableaux ont ete transferes : pas de reprise directe
    w.postMessage({ step: res, nom }, res.meshes.flatMap((m) => [m.pos.buffer, m.idx.buffer]));
  }
  function lireFichier(f, suite) {
    if (!f) return;
    apres = suite || null;
    if (/\.(stp|step)$/i.test(f.name)) { lireStepFichier(f); return; }
    if (!/\.(ifc|ifczip|zip)$/i.test(f.name)) { toast("Choisissez un fichier .ifc, .ifczip ou .stp (les fichiers Revit .rvt ne s'ouvrent pas : demandez l'export IFC)."); return; }
    lire(f, f.name);
  }
  // ---------- Orientation d'un STEP : poser sur une face, rotations de 90 degres, angle precis ; reversible ----------
  function majOrient() {
    const id = !M || IFC.estIdentite(M.rot);
    $("#oAnnuler").disabled = id; $("#bOrienter").classList.toggle("actif", !id);
  }
  function appliquerOrientation(R) {
    if (!M || M.source !== "step") return;
    IFC.pivoter(M, R);
    if (etat.coupe) poserCoupe(null);
    FAC = null; indexRech = null; construire(); onglet(ongletActif); afficherProps(); cadrer(); majOrient();
  }
  function basculerPoser(on = !etat.poser) {
    if (on && etat.mesure) basculerMesure(false);
    etat.poser = on; $("#oPoser").setAttribute("aria-pressed", String(on)); cv.classList.toggle("viseur", on);
    $("#oAide").textContent = on ? "Cliquez maintenant la face du modèle qui doit devenir le dessous (Échap pour annuler)." : "Cliquez la face du modèle qui doit devenir le dessous.";
  }
  function panneauOrient(on) { $("#panOrient").hidden = !on; $("#bOrienter").setAttribute("aria-expanded", String(on)); if (!on) basculerPoser(false); }
  $("#bOrienter").addEventListener("click", () => panneauOrient($("#panOrient").hidden));
  $("#oFermer").addEventListener("click", () => panneauOrient(false));
  $("#oPoser").addEventListener("click", () => basculerPoser());
  $("#panOrient").addEventListener("click", (e) => { const b = e.target.closest("[data-rot]"); if (!b) return; const [axe, deg] = b.dataset.rot.split(":"); appliquerOrientation(IFC.matriceAxe(axe, +deg)); });
  $("#oAnnuler").addEventListener("click", () => { if (!M) return; IFC.annulerPivot(M); if (etat.coupe) poserCoupe(null); FAC = null; indexRech = null; construire(); onglet(ongletActif); afficherProps(); cadrer(); majOrient(); toast("Orientation d'origine rétablie."); });
  // ---------- Comparaison de deux versions : le fichier ouvert = ancienne version, le fichier choisi = nouvelle version ----------
  function lancerComparaison(A, nomA, B, nomB) {
    if (!B.produits.length) { toast("Aucun élément 3D dans le fichier à comparer."); return; }
    if ((A.source === "step") !== (B.source === "step")) { toast("Comparez deux fichiers du même type (deux IFC, ou deux STEP)."); return; }
    const t0 = performance.now(), R = IFC.comparer(A, B), C = IFC.fusionComparaison(A, B, R);
    etat.cmp = { A, B, nomA, nomB, R, vis: new Set(["ajoute", "supprime", "modifie", "deplace"]), fond: true };
    afficherModele(C, `${nomA} → ${nomB}`, performance.now() - t0);
    $("#infos").textContent = `Comparaison · ${R.cle === "gid" ? "appariement par GlobalId" : "appariement par type et nom, puis par forme"} · tolérance 1 mm`;
    majBarreCmp();
    const c = R.compte; toast(`${c.ajoute} ajouté${c.ajoute > 1 ? "s" : ""}, ${c.supprime} supprimé${c.supprime > 1 ? "s" : ""}, ${c.modifie} modifié${c.modifie > 1 ? "s" : ""}, ${c.deplace} déplacé${c.deplace > 1 ? "s" : ""}.`);
  }
  function majBarreCmp() {
    const k = etat.cmp, z = $("#zoneCmp"); z.hidden = !k; if (!k) return;
    $("#cmpNoms").textContent = `${k.nomA} → ${k.nomB}`; $("#cmpNoms").title = `Ancienne version : ${k.nomA}\nNouvelle version : ${k.nomB}`;
    $("#cmpChips").innerHTML = ["supprime", "ajoute", "modifie", "deplace"].map((s2) => `<button type="button" class="chip-cmp" data-cmps="${s2}" style="--c:${CMP[s2].css}" aria-pressed="${k.vis.has(s2)}"${k.R.compte[s2] ? "" : " disabled"}><i></i>${{ ajoute: "Ajoutés", supprime: "Supprimés", modifie: "Modifiés", deplace: "Déplacés" }[s2]} <b>${k.R.compte[s2]}</b></button>`).join("");
    $("#cmpFond").checked = k.fond;
  }
  $("#bCompare").addEventListener("click", () => { if (M) $("#ouvrir3").click(); });
  $("#ouvrir3").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !M) return;
    const A = etat.cmp ? etat.cmp.A : M, nomA = etat.cmp ? etat.cmp.nomA : nomFichier;
    lireFichier(f, (B, nomB) => lancerComparaison(A, nomA, B, nomB));
  });
  $("#cmpChips").addEventListener("click", (e) => { const b = e.target.closest("[data-cmps]"); if (!b || !etat.cmp) return; const s2 = b.dataset.cmps; etat.cmp.vis.has(s2) ? etat.cmp.vis.delete(s2) : etat.cmp.vis.add(s2); majBarreCmp(); onglet(ongletActif); sigPrec = null; envoyer(); });
  $("#cmpFond").addEventListener("change", (e) => { if (etat.cmp) { etat.cmp.fond = e.target.checked; sigPrec = null; envoyer(); } });
  $("#cmpInverser").addEventListener("click", () => { const k = etat.cmp; if (k) lancerComparaison(k.B, k.nomB, k.A, k.nomA); });
  $("#cmpQuitter").addEventListener("click", () => { const k = etat.cmp; if (!k) return; etat.cmp = null; afficherModele(k.B, k.nomB, 0); $("#infos").textContent = "Retour à la nouvelle version"; });
  $("#ouvrir2").addEventListener("change", (e) => { lireFichier(e.target.files[0]); e.target.value = ""; });
  $("#bExemple").addEventListener("click", async () => {
    try { const r = await fetch("exemples/TinyHouse.ifc"); if (!r.ok) throw new Error(r.status); lire(await r.text(), "TinyHouse.ifc (exemple)"); }
    catch { toast("Exemple indisponible pour le moment."); }
  });
  $("#ouvrir").addEventListener("change", (e) => { lireFichier(e.target.files[0]); e.target.value = ""; });
  const zone = $("#scene");
  ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("depot"); }));
  ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("depot"); }));
  zone.addEventListener("drop", (e) => lireFichier(e.dataTransfer.files[0]));

  // ---------- Taille du canvas ----------
  function dimensionner() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = cal.width = Math.round(W * dpr); cv.height = cal.height = Math.round(H * dpr); redessiner();
  }
  new ResizeObserver(() => { const avant = W; dimensionner(); if (!avant && M) cadrer(); }).observe(cv);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", envoyer);
  new MutationObserver(envoyer).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  dimensionner();
  window.__viewer = { etat, cam, visible, choisir, vue, poserCoupe, basculerMesure, lire, get M() { return M; }, testerBoite: async (cible) => (await import("./step.js?v=1.17")).testerBoite(cible) };


// ======================= Bandeau commun de la famille =======================
const el = (id) => document.getElementById(id);
const APPLIS = [
  ["Check", "Notes & tâches", "#4338CA"],
  ["Index", "Fiches techniques", "#6D4AFF"],
  ["Access", "Annuaire fournisseurs", "#C2255C"],
  ["Trame", "Répartition de perçages", "#0E9F6E"],
  ["Linear", "Mise en barre", "#2B50FF"],
  ["Format", "Débit de panneaux", "#FF4D00"],
  ["Joint", "Dilatation et joints", "#0B7285"],
  ["Maquette", "Maquettes IFC", "#4D7C0F"],
  ["Masse", "Poids des éléments", "#9A4A3A"],
  ["Membrane", "Étanchéité", "#B45309"],
  ["Strate", "Épaisseurs d'isolation", "#D4A20B"],
];
el("appsList").innerHTML = `<div class="apps-label">Mes outils</div>
  <a href="https://outils-hn.github.io/"><span class="sw" style="background:conic-gradient(#C2255C 0 25%,#6D4AFF 0 50%,#0E9F6E 0 75%,#FF4D00 0)"></span><span class="nm">Accueil</span><span class="rl">Toutes les applis, idées &amp; bugs</span></a>
  <div class="apps-sep" role="separator"></div>` +
  APPLIS.map(([nom, role, c]) => `<a href="https://outils-hn.github.io/${nom}/"${nom === "Maquette" ? ' aria-current="page"' : ""}><span class="sw" style="background:${c}"></span><span class="nm">${nom}</span><span class="rl">${role.replace("&", "&amp;")}</span>${nom === "Maquette" ? '<span class="ck" aria-hidden="true">✓</span>' : ""}</a>`).join("");
document.addEventListener("click", (e) => { const m = el("appsMenu"); if (m.open && !m.contains(e.target)) m.open = false; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el("appsMenu").open) { el("appsMenu").open = false; el("appsMenu").querySelector("summary").focus(); } });

// Theme clair / sombre (reglage commun aux applis)
const ICONES = {
  light: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};
function themeActuel() {
  try { const t = localStorage.getItem("outils-theme"); if (t === "light" || t === "dark") return t; } catch (e) { /* ignore */ }
  return matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function appliquerTheme(k) {
  document.documentElement.dataset.theme = k;
  try { localStorage.setItem("outils-theme", k); } catch (e) { /* ignore */ }
  const nom = k === "dark" ? "Thème sombre" : "Thème clair";
  el("themeBtn").innerHTML = ICONES[k]; el("themeBtn").title = nom; el("themeBtn").setAttribute("aria-label", `${nom} (cliquer pour changer)`);
}
el("themeBtn").addEventListener("click", () => appliquerTheme(themeActuel() === "dark" ? "light" : "dark"));
appliquerTheme(themeActuel());

// A propos
el("aboutBtn").addEventListener("click", () => el("dApropos").showModal());
el("daFermer").addEventListener("click", () => el("dApropos").close());

// Compte (meme connexion que les autres applis)
const SB_URL = "https://dtxgvwaqjmmffiiohika.supabase.co";
const SB_KEY = "sb_publishable_yEWGxFFSLTE1lJRXnFUmpg_dMwa6LxW";
const SESSION_KEY = "sb-dtxgvwaqjmmffiiohika-auth-token";
const lireSession = () => { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY)); return s && s.access_token ? s : null; } catch (e) { return null; } };
const ecrireSession = (s) => { try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } };
function nomAffiche(u) {
  const m = (u && u.user_metadata) || {};
  const txt = (v) => (typeof v === "string" ? v.trim() : "");
  const maj = (s) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_x, a, b) => a + b.toUpperCase());
  let prenom = txt(m.first_name), nom = txt(m.last_name);
  if (!prenom || !nom) { const mots = txt(m.display_name).split(/\s+/).filter(Boolean); if (mots.length >= 2) { prenom = mots.slice(0, -1).join(" "); nom = mots[mots.length - 1]; } }
  return prenom && nom ? `${maj(prenom)} ${nom.toLocaleUpperCase("fr")}` : "";
}
const identifiant = (email) => (String(email || "").toLowerCase().endsWith("@equipe.invalid") ? String(email).slice(0, -15) : "");
function afficherCompte() {
  const s = lireSession();
  el("etatCompte").textContent = s ? (nomAffiche(s.user) || identifiant(s.user?.email) || s.user?.email || "") : "Lecture seule";
  el("etatCompte").title = s ? (s.user?.email || "") : "";
  el("etatCompte").classList.toggle("on", !!s);
  el("compteBtn").textContent = s ? "Se déconnecter" : "Se connecter";
}
async function seConnecter(saisie, mdp) {
  const t = saisie.trim(), email = t.includes("@") ? t : `${t.toLowerCase()}@equipe.invalid`;
  try {
    const r = await fetch(SB_URL + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: mdp }) });
    const j = await r.json();
    if (!r.ok) { const m = String(j.error_description || j.msg || ""); return /invalid login/i.test(m) ? "Identifiant ou mot de passe incorrect." : (m || "Connexion impossible."); }
    ecrireSession({ ...j, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) }); return null;
  } catch (e) { return "Pas de connexion au serveur."; }
}
el("compteBtn").addEventListener("click", () => {
  if (lireSession()) { ecrireSession(null); afficherCompte(); location.href = "https://outils-hn.github.io/"; return; }
  el("formConnexion").reset(); el("cErreur").textContent = ""; el("dConnexion").showModal(); el("cEmail").focus();
});
el("formConnexion").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("cOk").disabled = true;
  const err = !el("cEmail").value || !el("cMdp").value ? "Saisissez l'identifiant et le mot de passe." : await seConnecter(el("cEmail").value, el("cMdp").value);
  el("cOk").disabled = false;
  if (err) { el("cErreur").textContent = err; return; }
  el("dConnexion").close(); afficherCompte(); verifierAcces();
});
el("cAnnuler").addEventListener("click", () => el("dConnexion").close());
window.addEventListener("storage", (e) => { if (e.key === SESSION_KEY) afficherCompte(); });
afficherCompte();

// Appli en preparation : sur le vrai site, seul le concepteur la voit (les autres retournent a l'Accueil)
async function verifierAcces() {
  if (!RESERVEE_CONCEPTEUR || location.hostname !== "outils-hn.github.io") return;
  const s = lireSession(); if (!s) return; // garde.js renvoie deja vers l'Accueil sans compte
  try {
    const r = await fetch(SB_URL + "/rest/v1/rpc/mon_role", { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" }, body: "{}" });
    if (r.ok && (await r.json()) !== "concepteur") location.replace("https://outils-hn.github.io/");
  } catch (e) { /* hors ligne : rien */ }
}
verifierAcces();

// Recherche globale (Ctrl+K ou bouton) : ouvre l'Accueil dans un autre onglet
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); window.open("https://outils-hn.github.io/#recherche", "outils-accueil"); } });
el("rechercheBtn").addEventListener("click", () => window.open("https://outils-hn.github.io/#recherche", "outils-accueil"));

// Touche « ? » : raccourcis clavier
(function raccourcisAide() {
  const lignes = [
    [["Ctrl", "K"], "Rechercher dans toutes les applis"],
    [["M"], "Mesurer une distance"],
    [["F"], "Cadrer la maquette ou l'élément choisi"],
    [["Échap"], "Quitter la mesure, désélectionner"],
    [["?"], "Afficher cette liste"],
  ];
  const kbd = (t) => `<kbd style="border:1px solid var(--line-strong);border-radius:4px;padding:1px 6px;font:12px var(--mono);background:var(--sunk)">${t}</kbd>`;
  const d = document.createElement("dialog");
  d.id = "dRaccourcis"; d.setAttribute("aria-labelledby", "dr-titre");
  d.innerHTML = `<div class="apropos"><h3 id="dr-titre">Raccourcis clavier</h3>${lignes.map(([t, x]) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid var(--line)"><span>${x}</span><span style="display:flex;gap:4px;flex:none">${t.map(kbd).join("")}</span></div>`).join("")}<form method="dialog" class="actions"><button class="btn primaire">Fermer</button></form></div>`;
  document.body.appendChild(d);
  el("appsList").insertAdjacentHTML("beforeend", `<div class="apps-sep" role="separator"></div><a href="#raccourcis" id="raccourcisBtn"><span class="sw ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10"/></svg></span><span class="nm">Raccourcis</span><span class="rl">Touches du clavier · ?</span></a>`);
  el("raccourcisBtn").addEventListener("click", (e) => { e.preventDefault(); el("appsMenu").open = false; d.showModal(); });
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || document.querySelector("dialog[open]")) return;
    e.preventDefault(); d.showModal();
  });
})();
void VERSION;
