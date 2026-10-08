const CACHE = 'reaction-course-shell-v24'
const scopePath = new URL(self.registration.scope).pathname
const BASE = scopePath.endsWith('/') ? scopePath : `${scopePath}/`
const SHELL = [BASE, `${BASE}manifest.webmanifest`, `${BASE}icons/icon.svg`, `${BASE}icons/icon-192.png`, `${BASE}icons/icon-512.png`]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('reaction-course-shell-') && key !== CACHE).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/coach.html') || /\/assets\/coach[-.]/.test(url.pathname)) return
  if (request.mode === 'navigate' || /\/assets\/player[-.].*\.js$/.test(url.pathname)) {
    const freshUrl = new URL(request.url)
    freshUrl.searchParams.set('_release', CACHE)
    event.respondWith(fetch(new Request(freshUrl, { cache: 'no-store', credentials: request.credentials })).then((response) => {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(request.mode === 'navigate' ? BASE : request, copy))
      return response
    }).catch(() => caches.match(request.mode === 'navigate' ? BASE : request)))
    return
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(request, copy))
    }
    return response
  })))
})
