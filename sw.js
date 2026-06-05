/* ============================================================
   Service Worker - המעקב שלי
   גרסה: 1.3.0
   תפקיד: caching בסיסי + הצגת התראות יומיות
   
   שינויים בגרסה 1.3.0:
   - הסרת splash.mp4 מה-cache (הפיצ'ר הוסר לטובת פתיחה מהירה)
   - אייקונים חדשים (לוגו Health Mate החדש)
   - bumped cache name לאלץ עדכון מלא אצל המשתמשים
   ============================================================ */

// Cache name is auto-unique PER CLONE (based on this app's folder path), so
// several participant apps hosted on the same domain never overwrite or
// delete each other's cached files. Bump CACHE_VERSION to force an update.
const CACHE_VERSION = 'v1-4';
const CACHE_PREFIX = 'nutrition-tracker-' + self.location.pathname.replace(/sw\.js$/, '');
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const CORE_FILES = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './sw.js'
];

// ===== Install =====
self.addEventListener('install', (event) => {
    console.log('[SW] Installing v1.3.0...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_FILES))
            .then(() => self.skipWaiting())
            .catch(err => console.warn('[SW] Cache failed:', err))
    );
});

// ===== Activate =====
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating v1.3.0... clearing old caches');
    event.waitUntil(
        caches.keys().then(keys => 
            Promise.all(
                keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => {
                    console.log('[SW] Deleting old cache:', k);
                    return caches.delete(k);
                })
            )
        ).then(() => self.clients.claim())
    );
});

// ===== Fetch - network first, fallback to cache =====
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith(self.location.origin)) return;
    
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    }).catch(() => {});
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

// ===== Notification click - open the app =====
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                for (const client of clientList) {
                    if ('focus' in client) return client.focus();
                }
                if (clients.openWindow) return clients.openWindow('./');
            })
    );
});

// ===== Push from server - show the daily notification =====
// Fired by the OS when the GitHub Action sends a web push, even when the
// app is fully closed. This is what makes closed-app delivery work on
// both iOS (16.4+, installed to Home Screen) and Android.
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { body: event.data ? event.data.text() : '' };
    }
    const title = data.title || '🎯 3 המטרות שלך להיום';
    const options = {
        body: data.body || 'פתח את האפליקציה ובדוק את 3 המטרות של היום',
        tag: data.tag || 'daily-goals',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        lang: 'he',
        dir: 'rtl',
        requireInteraction: false,
        vibrate: [200, 100, 200],
        data: { url: './' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// ===== Message from app - show notification (used for the local test) =====
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, tag } = event.data;
        self.registration.showNotification(title || 'המעקב שלי', {
            body: body || '',
            tag: tag || 'daily-goals',
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            lang: 'he',
            dir: 'rtl',
            requireInteraction: false,
            vibrate: [200, 100, 200]
        });
    }
});
