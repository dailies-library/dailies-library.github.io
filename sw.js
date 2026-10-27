// Serves each person's pictures and videos at this site's own /_blob/<id> address (stored in Supabase), so the
// page can draw them on canvases (colours, moodboards, storyboards) and pictures are kept in this browser.
// The files are private: they are fetched with the signed-in person's token, which the page hands over (web/supa.js),
// and storage only gives anyone the files in their own folder.
const SUPA = 'https://cthexlqrspcnbvylpmyg.supabase.co'
const KEY = 'sb_publishable_ghwozZU9ed1yKqzinYlkEA_wUcHbPF8' // the public key, as in web/supa.js
const FILES = SUPA + '/storage/v1/object/authenticated/media/'
const CACHED = SUPA + '/storage/v1/object/public/media/' // cache keys: the files' old public address, so pictures kept before stay kept
const CACHE = 'dailies-media-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

// ---- the signed-in person's token: sent by the page on sign-in and on every refresh; asked for again after a restart
let token = null
let waiting = []
self.addEventListener('message', e => {
  const m = e.data
  if (!m || m.type !== 'dailies:token') return
  const was = token
  token = m.token || null
  for (const f of waiting) f(token)
  waiting = []
  if (was && !token) e.waitUntil(caches.delete(CACHE)) // signed out: this browser forgets the pictures too
})
async function askToken(fresh) {
  if (token && !fresh) return token
  if (fresh) token = null
  const tabs = await self.clients.matchAll({ type: 'window' })
  for (const c of tabs) c.postMessage({ type: 'dailies:token?' })
  return new Promise(r => { waiting.push(r); setTimeout(() => r(token), 3000) })
}

// A stored file is never shown as a page of this site: anything in it that could run (an SVG's script, an HTML file) is
// switched off, so a file can't act as Dailies in someone's browser.
function safe(res) {
  const h = new Headers(res.headers)
  h.set('content-security-policy', "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'")
  h.set('x-content-type-options', 'nosniff')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}
async function fetchFile(path, range) {
  let res
  for (const fresh of [false, true]) { // a token that just ran out: ask the page for a new one and try once more
    const t = await askToken(fresh)
    if (!t) return new Response('Open Dailies and sign in to see this file.', { status: 401, headers: { 'content-type': 'text/plain' } })
    const headers = { authorization: 'Bearer ' + t, apikey: KEY }
    if (range) headers.range = range
    res = await fetch(FILES + path, { headers, mode: 'cors' })
    if (![400, 401, 403].includes(res.status)) break
  }
  return res
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/_blob/') || e.request.method !== 'GET') return
  const path = url.pathname.slice('/_blob/'.length)
  const range = e.request.headers.get('range')
  if (range) { e.respondWith(fetchFile(path, range).then(safe)); return } // videos stream in parts
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(CACHED + path)
    if (hit) return safe(hit)
    const res = await fetchFile(path)
    // ids never change, so a picture fetched once is kept; videos are left to the browser's own cache
    if (res.status === 200 && !/^video\//.test(res.headers.get('content-type') || '')) cache.put(CACHED + path, res.clone()).catch(() => {})
    return safe(res)
  })())
})
