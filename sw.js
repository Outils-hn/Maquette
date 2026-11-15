// Service worker de Maquette : l'appli s'ouvre aussi sans reseau (la maquette, elle, reste sur le poste).
// En ligne : on prend toujours la version la plus recente, qu'on garde en copie. Hors ligne : on sert la copie.
// Les echanges avec la base (Supabase) ne passent jamais par ici.
const VERSION = "1.23";
const CACHE = "maquette-" + VERSION;
const DELAI_MS = 3000; // reseau trop lent (chantier, sous-sol) : apres 3 s on sert la copie
// Lecteur STEP (7,6 Mo, version figee, empreinte verifiee par la page) : garde d'une version de l'appli a l'autre, sans retelechargement
const CACHE_MOTEUR = "moteur-step-1";
const FIXES = ["./", "index.html", "icone-192.png", "icone-512.png", "fonts/Geist-wght.woff2", "fonts/GeistMono-wght.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(FIXES.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("maquette-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// La page envoie la liste de ce qu'elle a charge (scripts, styles, polices) : tout part dans la copie hors ligne.
self.addEventListener("message", (e) => {
  const urls = (e.data && e.data.precache) || [];
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(urls.map((u) => c.add(u)))));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const memeOrigine = url.origin === self.location.origin;
  if (!memeOrigine) return; // base de donnees, etc. : on ne touche pas
  if (memeOrigine && /\/vendor\/occt\/occt-import-js\.(js|wasm)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE_MOTEUR).then((c) => c.match(req).then((m) => m || fetch(req).then((rep) => { if (rep && rep.ok) c.put(req, rep.clone()); return rep; }))));
    return;
  }
  const copie = () => caches.match(req).then((m) => m || caches.match(req, { ignoreSearch: true })).then((m) => m || (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
  e.respondWith((async () => {
    const reseau = fetch(req).then((rep) => {
      if (rep && rep.ok) { const c = rep.clone(); caches.open(CACHE).then((ch) => ch.put(req, c)); }
      return rep;
    });
    const delai = new Promise((res) => setTimeout(() => res(null), DELAI_MS));
    try {
      const rep = await Promise.race([reseau, delai]);
      if (rep) return rep;
      const m = await copie();
      return m && m.type !== "error" ? m : reseau; // pas de copie : on attend le reseau
    } catch (_) { return copie(); }
  })());
});
