// Serves each person's pictures and videos at this site's own /_blob/<id> address (stored in Supabase), so the
// page can draw them on canvases (colours, moodboards, storyboards) and pictures are kept in this browser.
// The files are private: they are fetched with the signed-in person's token, which the page hands over (web/supa.js),
// and storage only gives anyone the files in their own folder.
const SUPA = 'https://cthexlqrspcnbvylpmyg.supabase.co'
const KEY = 'sb_publishable_ghwozZU9ed1yKqzinYlkEA_wUcHbPF8' // the public key, as in web/supa.js
const FILES = SUPA + '/storage/v1/object/authenticated/media/'
const CACHED = SUPA + '/storage/v1/object/public/media/' // cache keys: the files' old public address, so pictures kept before stay kept
const CACHE = 'dailies-media-v1'
const SHARE = 'dailies-share' // what was shared from a phone's Share menu, until the page has saved it
const KEEP_VIDEO = 20 * 1048576 // a video up to this size is kept in this browser after its first play (Dailies keeps whole only the small ones)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

// ---- the signed-in person's token: sent by the page on sign-in and on every refresh; asked for again after a restart
let token = null
let waiting = []
self.addEventListener('message', e => {
  const m = e.data
  if (m && m.type === 'dailies:claim') { e.waitUntil(self.clients.claim()); return } // a page that loaded without this worker (a hard reload)
  if (!m || m.type !== 'dailies:token') return
  token = m.token || null
  for (const f of waiting) f(token)
  waiting = []
  // signed out: this browser forgets the pictures too. Only on a real sign-out: a moment without a token (a refresh, a second
  // tab) used to wipe every kept picture, and the whole wall then downloaded again and filled in unevenly (27 Oct)
  if (m.signedOut && !token) e.waitUntil(caches.delete(CACHE))
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

// A video kept in this browser answers the parts a player asks for (Range), just as storage would, so it starts at once
async function rangeOf(res, range) {
  const blob = await res.blob(), size = blob.size
  const m = /bytes=(\d*)-(\d*)/.exec(range || '')
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : size - 1
  if (m && !m[1] && m[2]) { start = Math.max(0, size - +m[2]); end = size - 1 } // "the last n bytes"
  end = Math.min(end, size - 1)
  if (start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
  return new Response(blob.slice(start, end + 1), { status: 206, headers: { 'content-type': res.headers.get('content-type') || blob.type, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1), 'accept-ranges': 'bytes' } })
}
// the first time a video plays, the whole file is fetched once in the background and kept, so the next hover plays from here
const keeping = new Set()
async function keepWhole(path) {
  if (keeping.has(path)) return
  keeping.add(path)
  try {
    const res = await fetchFile(path)
    if (res.status !== 200 || +(res.headers.get('content-length') || 0) > KEEP_VIDEO) return
    const blob = await res.blob()
    if (blob.size <= KEEP_VIDEO) await (await caches.open(CACHE)).put(CACHED + path, new Response(blob, { headers: { 'content-type': res.headers.get('content-type') || blob.type } }))
  } catch { /* next time */ } finally { keeping.delete(path) }
}

// Shared to Dailies from a phone's Share menu (manifest share_target): keep the link, text and files, then open Dailies, which
// saves them as soon as your library is ready (46-share-target.js). Kept here, so a share made while signed out isn't lost.
async function receiveShare(req) {
  // the phone's Share menu sends no referrer; a form on another website that posts here does, so that is refused
  let from = ''; try { from = req.referrer ? new URL(req.referrer).origin : '' } catch { /* no referrer */ }
  if (from && from !== self.location.origin) return Response.redirect('/', 303)
  const form = await req.formData().catch(() => null)
  if (form) {
    const box = await caches.open(SHARE)
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const files = form.getAll('media').filter(f => f && typeof f !== 'string' && f.size && f.size <= 1024 * 1048576).slice(0, 10)
    const meta = { title: String(form.get('title') || '').slice(0, 500), text: String(form.get('text') || '').slice(0, 5000), url: String(form.get('url') || '').slice(0, 2000), files: [] }
    for (const [i, f] of files.entries()) {
      const key = `/__share/${id}/${i}`
      await box.put(key, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }))
      meta.files.push({ key, type: f.type || '', name: String(f.name || '').slice(0, 200) })
    }
    await box.put(`/__share/${id}/meta`, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }))
  }
  return Response.redirect('/?shared=1', 303)
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (url.origin === self.location.origin && url.pathname === '/share-target' && e.request.method === 'POST') { e.respondWith(receiveShare(e.request)); return }
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/_blob/') || e.request.method !== 'GET') return
  const path = url.pathname.slice('/_blob/'.length)
  const range = e.request.headers.get('range')
  if (range) { // videos stream in parts: from this browser once kept, otherwise from storage while the whole file is kept for next time
    e.respondWith((async () => {
      const hit = await (await caches.open(CACHE)).match(CACHED + path)
      if (hit) return safe(await rangeOf(hit, range))
      try { e.waitUntil(keepWhole(path)) } catch { keepWhole(path) }
      return safe(await fetchFile(path, range))
    })())
    return
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(CACHED + path)
    if (hit) return safe(hit)
    const res = await fetchFile(path)
    // ids never change, so a file fetched once is kept (a video only up to KEEP_VIDEO)
    if (res.status === 200 && (!/^video\//.test(res.headers.get('content-type') || '') || +(res.headers.get('content-length') || 0) <= KEEP_VIDEO)) cache.put(CACHED + path, res.clone()).catch(() => {})
    return safe(res)
  })())
})
