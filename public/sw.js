// FahamLah service worker: lets the site work offline. Small and hand-written.
// The build (src/integrations/pwa.ts) writes BUILD and PRECACHE into dist/sw.js.
//  - Pages (HTML): network first, then the saved copy, then the bilingual offline page.
//  - /_astro/* files have a hash in their name, so they never change: cache first.
//  - Every page you open is saved, with the files it needs, so it works offline later.
//  - A new build gets new caches. It takes over when no FahamLah tab still uses the old one
//    (no skipWaiting), then deletes the old caches, so an open page never loses its files.
const BUILD = '__FAHAMLAH_BUILD__';
const PRECACHE = ['__FAHAMLAH_PRECACHE__'];

const PREFIX = 'fahamlah-';
const SHELL = `${PREFIX}shell-${BUILD}`;
const PAGES = `${PREFIX}pages-${BUILD}`;
const ASSETS = `${PREFIX}assets-${BUILD}`;
const OFFLINE = '/offline/';
// Saved copies fit any request: build files never change, and servers may send "Vary: Origin".
const ANY = { ignoreVary: true };
// Hashed build files, e.g. /_astro/Choice.Di_12k4Q.js (also "./Choice.Di_12k4Q.js" inside JS).
const ASSET_RE = /["'`(](?:\/_astro\/|\.\/)([\w@.-]+\.[\w-]{8}\.(?:js|css))["'`)]/g;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, PAGES, ASSETS]);
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && !keep.has(key)) await caches.delete(key);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  if (req.mode === 'navigate') event.respondWith(page(event, url));
  else if (url.pathname.startsWith('/_astro/')) event.respondWith(asset(req));
  else event.respondWith(other(req));
});

// "Save all lessons for offline use" (settings page) sends the list of pages.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'save-pages' && Array.isArray(data.urls)) {
    event.waitUntil(savePages(data.urls, event.ports[0]));
  }
});

/** Same page, one key: no query, no hash. */
function pageKey(url) {
  return new URL(url.pathname, self.location.origin).href;
}

/** A redirected response cannot answer a page request, so make a clean copy. */
function clean(res) {
  if (!res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function findPage(url) {
  const keys = [pageKey(url)];
  if (!url.pathname.endsWith('/')) keys.push(pageKey(new URL(`${url.pathname}/`, url)));
  for (const name of [PAGES, SHELL]) {
    const cache = await caches.open(name);
    for (const key of keys) {
      const hit = await cache.match(key, ANY);
      if (hit) return hit;
    }
  }
  return undefined;
}

async function page(event, url) {
  try {
    const res = (await event.preloadResponse) || (await fetch(event.request));
    if (res.ok && res.type === 'basic') event.waitUntil(savePage(url, res.clone()).catch(() => {}));
    return res;
  } catch {
    const saved = await findPage(url);
    if (saved) return saved;
    const offline = await caches.match(OFFLINE, ANY);
    return offline || new Response('Offline / Luar talian', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function savePage(url, res) {
  const cache = await caches.open(PAGES);
  const html = await res.clone().text();
  await cache.put(pageKey(url), clean(res));
  await saveAssets(refs(html));
}

function refs(text) {
  return [...new Set([...text.matchAll(ASSET_RE)].map((m) => `/_astro/${m[1]}`))];
}

/** Save build files and the JS files they import, so islands still wake up offline. */
async function saveAssets(urls, seen = new Set()) {
  const cache = await caches.open(ASSETS);
  const shell = await caches.open(SHELL);
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    let res = (await cache.match(url, ANY)) || (await shell.match(url, ANY));
    if (!res) {
      try {
        res = await fetch(url);
      } catch {
        continue;
      }
      if (!res.ok) continue;
      await cache.put(url, res.clone());
    }
    if (url.endsWith('.js')) await saveAssets(refs(await res.text()), seen);
  }
}

async function asset(req) {
  const hit = (await caches.match(req, { ...ANY, cacheName: ASSETS })) || (await caches.match(req, { ...ANY, cacheName: SHELL }));
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(ASSETS);
    await cache.put(req, res.clone());
  }
  return res;
}

async function other(req) {
  try {
    return await fetch(req);
  } catch (err) {
    const hit = await caches.match(req, { ...ANY, cacheName: SHELL });
    if (hit) return hit;
    throw err;
  }
}

async function savePages(urls, port) {
  const list = [...new Set(urls)].filter((u) => typeof u === 'string' && u.startsWith('/')).slice(0, 2000);
  const total = list.length;
  let done = 0;
  let ok = 0;
  const work = async () => {
    while (list.length) {
      const path = list.shift();
      const url = new URL(path, self.location.origin);
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          await savePage(url, res);
          ok++;
        }
      } catch {
        /* offline or gone: count it and carry on */
      }
      done++;
      if (port) port.postMessage({ type: 'progress', done, ok, total });
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  if (port) port.postMessage({ type: 'done', done, ok, total });
}
