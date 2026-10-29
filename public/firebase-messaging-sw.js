/* global importScripts, firebase */
// Web push for the iPhone PWA (and desktop browsers). The page passes its Firebase config in the query string.
// The Firebase compat scripts are bundled under /fb/ at build time (no CDN).
importScripts('/fb/firebase-app-compat.js', '/fb/firebase-messaging-compat.js')

const config = JSON.parse(new URL(self.location.href).searchParams.get('config') || '{}')
firebase.initializeApp(config)
const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {}
  const data = payload.data || {}
  if (data.type === 'widget-refresh') return
  self.registration.showNotification(n.title || data.title || '', {
    body: n.body || data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    if (list.length) return list[0].focus()
    return self.clients.openWindow('/')
  }))
})
