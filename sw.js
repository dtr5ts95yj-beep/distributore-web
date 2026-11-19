// Tiene la web app nel telefono: si apre anche senza rete. Google Drive passa sempre dalla rete.
const VERSIONE = 'distributore-3.9';
const FILE = ['./', 'index.html', 'app.css', 'app.js', 'logica.js', 'drive.js', 'stampa.js', 'lettore.js', 'manifest.webmanifest',
  'lib/jszip.min.js', 'lib/pdf-lib.min.js', 'lib/pdf.min.mjs', 'lib/pdf.worker.min.mjs',
  'icone/icona-192.png', 'icone/icona-512.png', 'icone/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSIONE).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // prima la rete (così gli aggiornamenti arrivano subito), se manca la rete la copia salvata
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSIONE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
