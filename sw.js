// Serves each person's pictures and videos at this site's own /_blob/<id> address (stored in Supabase), so the
// page can draw them on canvases (colours, moodboards, storyboards) and pictures are kept in this browser.
const BASE = 'https://cthexlqrspcnbvylpmyg.supabase.co/storage/v1/object/public/media/'
const CACHE = 'dailies-media-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/_blob/') || e.request.method !== 'GET') return
  const target = BASE + url.pathname.slice('/_blob/'.length)
  const range = e.request.headers.get('range')
  if (range) { e.respondWith(fetch(target, { headers: { range }, mode: 'cors' })); return } // videos stream in parts
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(target)
    if (hit) return hit
    const res = await fetch(target, { mode: 'cors' })
    // ids never change, so a picture fetched once is kept; videos are left to the browser's own cache
    if (res.status === 200 && !/^video\//.test(res.headers.get('content-type') || '')) cache.put(target, res.clone()).catch(() => {})
    return res
  })())
})
