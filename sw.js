// Household6 Service Worker
const CACHE_NAME = 'household6-v6'; // Bumped version for security fixes
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/terms.html',
    '/privacy.html',
    '/css/styles.css',
    '/js/security.js', // Security utilities - MUST be cached
    '/js/app.js',
    '/js/firebase-config.js',
    '/js/auth.js',
    '/js/household.js',
    '/js/tasks.js',
    '/js/shopping.js',
    '/js/calendar.js',
    '/js/gemini.js',
    '/js/voice.js',
    '/js/locations.js',
    '/js/reminders.js',
    '/js/notifications.js',
    '/js/recipes.js',
    '/js/inventory.js',
    '/js/meal-categories.js',
    '/js/meal-planner.js',
    '/js/agenda.js',
    '/manifest.json',
    '/pages/voice.html'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Skip API requests (Firebase, Google Calendar, OpenRouteService)
    if (event.request.url.includes('googleapis.com') ||
        event.request.url.includes('firebaseio.com') ||
        event.request.url.includes('openrouteservice.org')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(event.request)
                    .then((response) => {
                        // Don't cache non-successful responses
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response
                        const responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    });
            })
    );
});

// Push notification event
self.addEventListener('push', (event) => {
    let data = { title: 'Household6', body: 'You have a notification' };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        vibrate: [200, 100, 200],
        data: data.data || {},
        actions: data.actions || []
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Focus existing window if available
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window if no existing window
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
    );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-tasks') {
        event.waitUntil(syncTasks());
    }
});

// Sync tasks that were created offline
async function syncTasks() {
    // This would sync any offline-created tasks
}

// Periodic background sync for morning reports
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'morning-report') {
        event.waitUntil(sendMorningReport());
    }
});

async function sendMorningReport() {
    // This would fetch today's data and send a notification
}
