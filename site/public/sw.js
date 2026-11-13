// Keeps earnrate.dev's main page working offline, for asking at the register
// with no signal. Everything it stores is the site's own files; nothing the
// visitor types is sent or cached here.
const CACHE = 'earnrate-v2'
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png']

// The built page names its scripts and styles with content hashes, so the
// current set is whatever the latest copy of "/" links to.
const assetsIn = (html) => [
  ...new Set(html.match(/\/assets\/[^"')\s]+/g) ?? []),
]

// One download per file, whether the page or refresh() asks for it first:
// after a deploy both want the new files at once, and the card data alone
// is a large file.
const saving = new Map()
function saveAsset(path) {
  let job = saving.get(path)
  if (!job) {
    job = (async () => {
      const response = await fetch(path)
      if (response.ok) {
        const cache = await caches.open(CACHE)
        await cache.put(path, response.clone())
      }
      return response
    })().finally(() => saving.delete(path))
    saving.set(path, job)
  }
  return job.then((response) => response.clone())
}

async function refresh(html) {
  const cache = await caches.open(CACHE)
  const assets = assetsIn(html)
  await Promise.all(
    assets.map(async (path) => {
      if (!(await cache.match(path))) await saveAsset(path)
    }),
  )
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    if (path.startsWith('/assets/') && !assets.includes(path))
      await cache.delete(request)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(SHELL)
      const page = await cache.match('/')
      if (page) await refresh(await page.text())
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return

  // The main page: the network first, so new card data shows up as soon as
  // it's deployed; the saved copy when offline.
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) {
            const copy = response.clone()
            event.waitUntil(
              (async () => {
                const html = await copy.clone().text()
                const cache = await caches.open(CACHE)
                await cache.put('/', copy)
                await refresh(html)
              })(),
            )
          }
          return response
        } catch {
          return (await caches.match('/')) ?? Response.error()
        }
      })(),
    )
    return
  }

  // The manifest and icons keep their names when they change, so they come
  // from the network first, like the page; the saved copy is for offline.
  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) {
            const cache = await caches.open(CACHE)
            await cache.put(url.pathname, response.clone())
          }
          return response
        } catch {
          return (await caches.match(url.pathname)) ?? Response.error()
        }
      })(),
    )
    return
  }

  // Hashed files never change, so a saved copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () =>
        (await caches.match(url.pathname)) ?? saveAsset(url.pathname))(),
    )
  }
})
