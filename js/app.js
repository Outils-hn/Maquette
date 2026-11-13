// Maquette : affichage (vue 3D WebGL, contenu, fiche, listes, mesures, coupes DXF) et bandeau commun.
// La lecture du fichier et la geometrie sont dans core.js (lancees dans worker.js pour ne pas figer la page).
import IFC from "./core.js?v=1.4";

const VERSION = "1.4";
// Appli en preparation : reservee au concepteur tant qu'Hugo ne l'ouvre pas a l'equipe (passer a false pour l'ouvrir)
const RESERVEE_CONCEPTEUR = true;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const mm = (m) => Math.round(m * 1000).toLocaleString("fr-CH");
  const m2 = (v) => v.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let M = null; // modele
  let nomFichier = "";
  const etat = { cache: new Set(), caches: new Set(), isole: null, sel: null, coupe: null, mesure: false, pts: [], survol: null };

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
  function couleurDe(p, m) {
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
    const bb = M.bbTout, c = bb.min.map((v, i) => (v + bb.max[i]) / 2), rad = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / 2 + 1;
    const dc = dt([c[0] - R.e[0], c[1] - R.e[1], c[2] - R.e[2]], R.f);
    let zn = dc - rad * 1.5, zf = dc + rad * 1.5;
    if (!cam.ortho) zn = Math.max(0.05, zn, zf / 2000);
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
    return { pi: best.t.p, p, accroche: !!snap };
  }

  // ---------- Vues ----------
  function boiteVisible() {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    M.produits.forEach((p, i) => { if (!visible(i)) return; for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.bb.min[k]); max[k] = Math.max(max[k], p.bb.max[k]); } });
    if (!isFinite(min[0])) { min = [0, 0, 0]; max = [1, 1, 1]; }
    if (etat.coupe) { const k = AXE[etat.coupe.axe]; max[k] = Math.min(max[k], etat.coupe.v); }
    return { min, max };
  }
  function cadrer(bb = boiteVisible()) {
    cam.cible = bb.min.map((v, i) => (v + bb.max[i]) / 2);
    const R = Math.max(0.5, Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / 2);
    cam.dist = R / Math.sin(cam.fov / 2) * 1.05;
    cam.ech = Math.min(W, H) / (2 * R * 1.08);
    redessiner();
  }
  const VUES = {
    "3d": { th: -0.95, ph: 0.42, ortho: false }, plan: { th: -Math.PI / 2, ph: 1.5697, ortho: true },
    a: { th: -Math.PI / 2, ph: 0, ortho: true }, b: { th: 0, ph: 0, ortho: true }, c: { th: Math.PI / 2, ph: 0, ortho: true }, d: { th: Math.PI, ph: 0, ortho: true },
  };
  function vue(nom) {
    Object.assign(cam, VUES[nom]);
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
      if (cam.ortho && !document.querySelector('[data-vue="plan"][aria-pressed="true"]')) { cam.ortho = false; document.querySelectorAll("[data-vue]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vue === "3d"))); }
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
    if (cam.ortho) cam.ech = Math.max(2, Math.min(5000, cam.ech / f)); else cam.dist = Math.max(0.3, Math.min(500, cam.dist * f));
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
        <div class="resume">${ligne("Projet", M.projet)}${ligne("Logiciel d'origine", M.logiciel)}${ligne("Format", M.schema)}${ligne("Éléments dessinés", M.produits.length)}${ligne("Étages", M.etages.length)}</div>
        ${M.aPsets ? "" : `<p class="note">Ce fichier ne contient pas de jeux de propriétés (Psets) : seuls les noms, matériaux et dimensions sont disponibles. Avec une maquette d'architecte bien renseignée, on verrait ici la valeur U, la résistance au feu, les références…</p>`}`;
      return;
    }
    const p = M.produits[etat.sel]; const bb = p.bb; const d = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
    const et = M.etages.find((e) => e.id === p.etage);
    const mur = p.mur != null ? M.produits.find((x) => x.id === p.mur) : null;
    let h = `<div class="tete"><span class="pastille" style="--c:${rgba((p.morceaux.find((m) => !m.verre && m.couleur) || {}).couleur?.rgb || IFC.couleurType(p.ifc), 1, 1)}"></span><div><h3>${esc(p.nom)}</h3><p>${esc(p.type)} <span class="mono">${esc(p.ifc.replace(/^IFC/, "Ifc").replace(/(Ifc)(.)(.*)/, (_m, a, b, c) => a + b + c.toLowerCase()))}</span></p></div></div>`;
    h += `<dl class="groupe"><h4>Identité</h4>${ligne("Étage", nomEtage(p.etage))}${ligne("Matériau", p.materiau)}${ligne("Description", p.desc)}${ligne("Type d'objet", p.objType)}${ligne("GlobalId", p.gid, true)}</dl>`;
    if (p.hauteur != null) h += `<dl class="groupe"><h4>${p.ifc === "IFCDOOR" ? "Porte" : "Fenêtre"}</h4>${ligne("Largeur", `${p.largeur.toLocaleString("fr-CH")} mm`, true)}${ligne("Hauteur", `${p.hauteur.toLocaleString("fr-CH")} mm`, true)}${et ? ligne("Allège (depuis l'étage)", `${mm(bb.min[2] - et.elev)} mm`, true) : ""}${ligne("Dans le mur", mur ? mur.nom : "—")}</dl>`;
    if (p.surf) h += `<dl class="groupe"><h4>Surfaces du mur</h4>${ligne("Longueur", `${mm(p.surf.L)} mm`, true)}${ligne("Hauteur", `${mm(p.surf.h)} mm`, true)}${ligne("Épaisseur", `${mm(p.surf.T)} mm`, true)}${ligne("Surface brute", `${m2(p.surf.brute)} m²`, true)}${ligne("Ouvertures et découpes", `${p.surf.trous} (${m2(p.surf.brute - p.surf.nette)} m²)`, true)}${ligne("Surface nette", `${m2(p.surf.nette)} m²`, true)}</dl>`;
    h += `<dl class="groupe"><h4>Encombrement mesuré</h4>${ligne("X", `${mm(d[0])} mm`, true)}${ligne("Y", `${mm(d[1])} mm`, true)}${ligne("Z", `${mm(d[2])} mm`, true)}${ligne("Niveau bas", `${mm(bb.min[2])} mm`, true)}</dl>`;
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
      return `<details class="etage" open><summary><span class="nom">${esc(e ? e.nom : "Sans étage")}</span><span class="cote mono">${e ? `${e.elev >= 0 ? "+" : ""}${mm(e.elev)}` : ""}</span><span class="nb">${n}</span>
        ${e ? `<button type="button" class="mini" data-plan="${k}" title="Vue en plan coupée à 1 m au-dessus de cet étage">Plan</button>` : ""}
        <button type="button" class="oeil" data-etage="${k}" aria-pressed="${!etat.cache.has(k)}" aria-label="Afficher ou masquer ${esc(e ? e.nom : "Sans étage")}"></button></summary>
        ${[...g.entries()].map(([t, l]) => `<details class="type"><summary><span class="nom">${esc(t)}</span><span class="nb">${l.length}</span></summary><ul>${l.map((i) => `<li><button type="button" data-pi="${i}">${esc(M.produits[i].nom)}</button></li>`).join("")}</ul></details>`).join("")}
      </details>`;
    }).join("");
    const types = [...new Set(M.produits.map((p) => p.type))].sort((a, b) => a.localeCompare(b, "fr"));
    $("#filtres").innerHTML = types.map((t) => `<button type="button" class="puce" data-type="${esc(t)}" aria-pressed="${!etat.caches.has(t)}">${esc(t)} <span>${M.produits.filter((p) => p.type === t).length}</span></button>`).join("");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pi != null) { choisir(+b.dataset.pi, false); if (b.closest("#tables")) cadrerSur(+b.dataset.pi); }
    else if (b.dataset.etage != null) { e.preventDefault(); const k = b.dataset.etage === "aucun" ? "aucun" : +b.dataset.etage; etat.cache.has(k) ? etat.cache.delete(k) : etat.cache.add(k); b.setAttribute("aria-pressed", String(!etat.cache.has(k))); envoyer(); }
    else if (b.dataset.type != null) { const t = b.dataset.type; etat.caches.has(t) ? etat.caches.delete(t) : etat.caches.add(t); b.setAttribute("aria-pressed", String(!etat.caches.has(t))); envoyer(); }
    else if (b.dataset.plan != null) { e.preventDefault(); const et = M.etages.find((x) => x.id === +b.dataset.plan); poserCoupe("z", et.elev + 1); vue("plan"); }
    else if (b.dataset.vue) vue(b.dataset.vue);
    else if (b.dataset.onglet) onglet(b.dataset.onglet);
  });

  // ---------- Outils : coupe, mesure, isoler ----------
  function bornes(axe) { const k = AXE[axe]; let a = Infinity, b = -Infinity; for (const p of M.produits) { a = Math.min(a, p.bb.min[k]); b = Math.max(b, p.bb.max[k]); } return [a, b]; }
  const NOMS_COUPE = { z: "Hauteur", x: "Position X", y: "Position Y" };
  function poserCoupe(axe, v) {
    etat.coupe = axe ? { axe, v } : null;
    $("#axeCoupe").value = axe || ""; $("#hauteur").disabled = !axe; $("#bDxf").disabled = !axe;
    if (axe) { const [a, b] = bornes(axe); $("#hauteur").value = String(Math.round(((v - a) / (b - a)) * 1000)); $("#hauteur").setAttribute("aria-label", NOMS_COUPE[axe]); }
    $("#valCoupe").textContent = axe ? `${axe.toUpperCase()} ${mm(v)}` : "—";
    construire(); redessiner();
  }
  $("#axeCoupe").addEventListener("change", (e) => {
    const axe = e.target.value; if (!axe) return poserCoupe(null);
    const [a, b] = bornes(axe); poserCoupe(axe, a + (b - a) * (axe === "z" ? 0.45 : 0.5));
    // on regarde la face coupee
    if (axe === "z") vue("plan"); else { Object.assign(cam, axe === "x" ? { th: -0.55, ph: 0.25, ortho: false } : { th: Math.PI / 2 - 0.55, ph: 0.25, ortho: false }); document.querySelectorAll("[data-vue]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.vue === "3d"))); cadrer(); }
  });
  $("#hauteur").addEventListener("input", (e) => { const axe = etat.coupe && etat.coupe.axe; if (!axe) return; const [a, b] = bornes(axe); poserCoupe(axe, a + (b - a) * (+e.target.value / 1000)); });

  // ---------- Export DXF de la coupe ----------
  const dD = $("#dDxf");
  let dxfTexte = "", dxfNom = "";
  function preparerDxf() {
    const c = etat.coupe; if (!c) return;
    const segs = IFC.couper(M, c, visible, $("#dVus").checked);
    const base = nomFichier.replace(/\.ifc.*$/i, "");
    const quoi = c.axe === "z" ? `plan coupe a ${mm(c.v)} mm` : c.axe === "x" ? `coupe verticale x = ${mm(c.v)} mm, vue depuis +X` : `coupe verticale y = ${mm(c.v)} mm, vue depuis +Y`;
    dxfTexte = IFC.dxf(segs, `${nomFichier} - ${quoi}`);
    dxfNom = `${base}-${c.axe === "z" ? "plan" : "coupe-" + c.axe}-${Math.round(c.v * 1000)}.dxf`;
    // apercu SVG
    let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    for (const s2 of segs) for (const q of [s2.a, s2.b]) { mn = [Math.min(mn[0], q[0]), Math.min(mn[1], q[1])]; mx = [Math.max(mx[0], q[0]), Math.max(mx[1], q[1])]; }
    const svg = $("#apercu");
    if (!segs.length) { svg.innerHTML = ""; $("#dInfo").textContent = "Rien n'est coupé à cet endroit : déplacez le curseur de coupe."; $("#dTelecharger").disabled = $("#dCopier").disabled = true; return; }
    const m = 0.2, w = mx[0] - mn[0] + 2 * m, h = mx[1] - mn[1] + 2 * m;
    svg.setAttribute("viewBox", `${mn[0] - m} ${-mx[1] - m} ${w} ${h}`);
    svg.innerHTML = segs.map((s2) => `<line class="c-${s2.calque}" x1="${s2.a[0]}" y1="${-s2.a[1]}" x2="${s2.b[0]}" y2="${-s2.b[1]}"/>`).join("");
    const calques = [...new Set(segs.map((s2) => s2.calque))];
    $("#legende").innerHTML = calques.map((c2) => `<span><i class="c-${c2}"></i>IFC-${c2} <b class="mono">${segs.filter((s2) => s2.calque === c2).length}</b></span>`).join("");
    $("#dInfo").textContent = `${segs.length} lignes · ${mm(mx[0] - mn[0])} × ${mm(mx[1] - mn[1])} mm · unités : mm, échelle 1:1 · ${dxfNom}`;
    $("#dTelecharger").disabled = $("#dCopier").disabled = false;
  }
  $("#bDxf").addEventListener("click", () => { preparerDxf(); dD.showModal(); });
  $("#dVus").addEventListener("change", preparerDxf);
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
    const base = nomFichier.replace(/\.ifc.*$/i, "");
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
  function basculerMesure(on = !etat.mesure) { etat.mesure = on; etat.pts = []; $("#bMesure").setAttribute("aria-pressed", String(on)); cv.classList.toggle("viseur", on); afficherProps(); redessiner(); }
  $("#bTout").addEventListener("click", () => { etat.isole = null; etat.cache.clear(); etat.caches.clear(); poserCoupe(null); arbre(); majOutils(); afficherProps(); vue("3d"); });
  function majOutils() { $("#bTout").classList.toggle("actif", !!etat.isole); }
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select") || document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") { if (etat.mesure) basculerMesure(false); else choisir(null); }
    if (!M || document.querySelector("dialog[open]")) return;
    if (e.key === "m" || e.key === "M") basculerMesure();
    if (e.key === "f" || e.key === "F") etat.sel != null ? cadrerSur(etat.sel) : cadrer();
  });

  // ---------- Listes (tableaux) et copie pour Excel ----------
  let ongletActif = "fen";
  const LISTES = {
    fen: {
      titre: "Fenêtres et portes", filtre: (p) => p.ifc === "IFCWINDOW" || p.ifc === "IFCDOOR",
      cols: ["Nom", "Type", "Étage", "Mur", "Largeur (mm)", "Hauteur (mm)", "Allège (mm)", "Surface (m²)"],
      ligne: (p) => { const et = M.etages.find((e) => e.id === p.etage); const mur = M.produits.find((x) => x.id === p.mur); return [p.nom, p.type, nomEtage(p.etage), mur ? mur.nom : "—", p.largeur, p.hauteur, et ? Math.round((p.bb.min[2] - et.elev) * 1000) : "", p.largeur && p.hauteur ? +(p.largeur * p.hauteur / 1e6).toFixed(2) : ""]; },
      total: (L) => ["Total", `${L.length} éléments`, "", "", "", "", "", +L.reduce((s, r) => s + (+r[7] || 0), 0).toFixed(2)],
    },
    murs: {
      titre: "Murs", filtre: (p) => !!p.surf,
      cols: ["Nom", "Étage", "Longueur (mm)", "Hauteur (mm)", "Épaisseur (mm)", "Brute (m²)", "Découpes", "Nette (m²)", "Matériau"],
      ligne: (p) => [p.nom, nomEtage(p.etage), Math.round(p.surf.L * 1000), Math.round(p.surf.h * 1000), Math.round(p.surf.T * 1000), +p.surf.brute.toFixed(2), p.surf.trous, +p.surf.nette.toFixed(2), p.materiau],
      total: (L) => ["Total", `${L.length} murs`, "", "", "", +L.reduce((s, r) => s + r[5], 0).toFixed(2), L.reduce((s, r) => s + r[6], 0), +L.reduce((s, r) => s + r[7], 0).toFixed(2), ""],
    },
    tout: {
      titre: "Tous les éléments", filtre: () => true,
      cols: ["Nom", "Type", "Étage", "Matériau", "X (mm)", "Y (mm)", "Z (mm)"],
      ligne: (p) => [p.nom, p.type, nomEtage(p.etage), p.materiau, Math.round((p.bb.max[0] - p.bb.min[0]) * 1000), Math.round((p.bb.max[1] - p.bb.min[1]) * 1000), Math.round((p.bb.max[2] - p.bb.min[2]) * 1000)],
      total: (L) => ["Total", `${L.length} éléments`, "", "", "", "", ""],
    },
  };
  const fmt = (v) => (typeof v === "number" ? v.toLocaleString("fr-CH") : v ?? "");
  function onglet(k) {
    ongletActif = k;
    if (!M) return;
    document.querySelectorAll("[data-onglet]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.onglet === k)));
    const L = LISTES[k]; const lignes = [];
    M.produits.forEach((p, i) => { if (L.filtre(p)) lignes.push({ i, r: L.ligne(p) }); });
    const num = (c) => /\(|Découpes/.test(c);
    $("#tables").innerHTML = lignes.length ? `<table><thead><tr>${L.cols.map((c) => `<th${num(c) ? ' class="n"' : ""}>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${lignes.map(({ i, r }) => `<tr${etat.sel === i ? ' class="sel"' : ""}>${r.map((v, j) => j === 0 ? `<td><button type="button" data-pi="${i}">${esc(v)}</button></td>` : `<td${num(L.cols[j]) ? ' class="n mono"' : ""}>${esc(fmt(v))}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr>${L.total(lignes.map((x) => x.r)).map((v, j) => `<td${num(L.cols[j]) ? ' class="n mono"' : ""}>${esc(fmt(v))}</td>`).join("")}</tr></tfoot></table>`
      : `<p class="vide">Aucun élément de ce genre dans la maquette.</p>`;
    document.querySelectorAll("[data-onglet]").forEach((b) => { const n = M.produits.filter(LISTES[b.dataset.onglet].filtre).length; b.querySelector("span").textContent = n; });
  }
  $("#bCopier").addEventListener("click", async () => {
    if (!M) return;
    const L = LISTES[ongletActif]; const rows = M.produits.filter(L.filtre).map(L.ligne);
    const tsv = [L.cols, ...rows, L.total(rows)].map((r) => r.map((v) => String(v ?? "").replace(/\t|\n/g, " ")).join("\t")).join("\n");
    try { await navigator.clipboard.writeText(tsv); toast(`« ${L.titre} » copié : collez dans Excel (Ctrl+V).`); }
    catch { const ta = $("#secours"); ta.hidden = false; ta.value = tsv; ta.select(); toast("Copie bloquée : le tableau est sélectionné, faites Ctrl+C."); }
  });
  let toastT; function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3400); }

  // ---------- Ouvrir un fichier (lu localement, jamais envoye) ----------
  function afficherModele(m, nom, ms) {
    if (!m.produits.length) { toast("Aucun élément 3D trouvé dans ce fichier."); return; }
    M = m; nomFichier = nom;
    Object.assign(etat, { cache: new Set(), caches: new Set(), isole: null, sel: null, coupe: null, pts: [] });
    if (etat.mesure) basculerMesure(false);
    $("#axeCoupe").value = ""; $("#hauteur").disabled = true; $("#bDxf").disabled = true; $("#valCoupe").textContent = "—";
    $("#accueil").hidden = true; $("#bCopier").disabled = false; $("#bStep").disabled = false;
    construire(); arbre(); onglet(ongletActif); afficherProps(); majOutils();
    $("#fichier").textContent = nom; document.title = `${nom} — Maquette`;
    $("#infos").textContent = `${m.schema}${m.logiciel ? ` · ${m.logiciel}` : ""} · ${m.produits.length} éléments · lu en ${ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`}`;
    // avertissements en langage courant (le detail technique reste au survol)
    const lisible = [...new Set(m.avertissements.map((a) => /^Ouvertures/.test(a) ? "certaines ouvertures ne sont pas découpées" : /^Découpes/.test(a) ? "certaines découpes de forme sont ignorées" : "quelques formes ne sont pas dessinées"))];
    const av = $("#avert"); av.hidden = !lisible.length; av.textContent = lisible.length ? `Maquette ouverte, mais ${lisible.join(", ")}.` : ""; av.title = m.avertissements.join("\n");
    dimensionner(); vue("3d");
  }
  // Lecture dans un travailleur en arriere-plan (la page reste fluide) ; a defaut, directement
  // source : texte IFC (exemple) ou fichier choisi (.ifc / .ifczip, lu et decompresse dans le worker)
  function lire(texte, nom) {
    const t0 = performance.now();
    $("#chargement").hidden = false; $("#chargementTxt").textContent = `Lecture de ${nom}…`;
    const fin = () => { $("#chargement").hidden = true; };
    const direct = () => setTimeout(async () => {
      try { afficherModele(IFC.build(typeof texte === "string" ? texte : await IFC.texteIFC(texte)), nom, performance.now() - t0); } catch (err) { toast(`Impossible de lire ce fichier : ${err.message}`); }
      fin();
    }, 30);
    let w;
    try { w = new Worker(new URL("./worker.js?v=1.4", import.meta.url), { type: "module" }); } catch (e) { direct(); return; }
    w.onmessage = (e) => {
      if (e.data.prog != null) { $("#chargementTxt").textContent = `Lecture de ${nom}… ${Math.round(e.data.prog * 100)} %`; return; }
      w.terminate(); fin(); if (e.data.ok) afficherModele(e.data.m, nom, performance.now() - t0); else toast(`Impossible de lire ce fichier : ${e.data.err}`);
    };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); direct(); };
    w.postMessage(texte);
  }
  function lireFichier(f) {
    if (!f) return;
    if (!/\.(ifc|ifczip|zip)$/i.test(f.name)) { toast("Choisissez un fichier .ifc ou .ifczip (les fichiers Revit .rvt ne s'ouvrent pas : demandez l'export IFC)."); return; }
    lire(f, f.name);
  }
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
  window.__viewer = { etat, cam, choisir, vue, poserCoupe, basculerMesure, lire, get M() { return M; } };


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
