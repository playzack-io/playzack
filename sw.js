// ZACK! 1.2.6 – offline cache
const CACHE = "zack-1.2.6";
const ASSETS = ["./", "index.html", "config.js", "backend.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!cacheable) return;
  if (req.mode === "navigate" || /\/(config|backend)\.js$/.test(url.pathname)) {
    const key = req.mode === "navigate" ? "index.html" : req;
    // neueste Version holen, offline aus dem Cache
    e.respondWith(fetch(req).then((res) => { const cl = res.clone(); caches.open(CACHE).then((c) => c.put(key, cl)); return res; }).catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") { const cl = res.clone(); caches.open(CACHE).then((c) => c.put(req, cl)); }
    return res;
  })));
});
