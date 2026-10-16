const VERSION = 'dev'
const SHELL = ['/']
const SHELL_CACHE = `shell-${VERSION}`
const DATA_CACHE = 'data-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)),
    // The first visit fetches the routes before this worker controls the page.
    caches.open(DATA_CACHE).then((c) => c.add(new Request('/data/routes.geojson', { cache: 'no-cache' }))),
  ]).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(req) {
  const cache = await caches.open(DATA_CACHE)
  try {
    const res = await fetch(req, { cache: 'no-cache' })
    if (res.ok) await cache.put(req, res.clone())
    return res
  } catch {
    return (await cache.match(req)) ?? Response.error()
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/data/')) return e.respondWith(networkFirst(req))
  if (req.mode === 'navigate') return e.respondWith(fetch(req).catch(() => caches.match('/', { cacheName: SHELL_CACHE })))
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)))
})
