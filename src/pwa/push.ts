import { doc, setDoc } from 'firebase/firestore'
import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import { app, db, firebaseConfig, usingEmulators } from '../firebase'
import { nativePushRegister } from './nativePush'

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'needsInstall' | 'notConfigured'

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

async function saveToken(hid: string, uid: string, token: string, platform: 'web' | 'android') {
  await setDoc(doc(db, `households/${hid}/devices/${token.slice(0, 120).replace(/\//g, '_')}`), {
    uid, token, platform, updatedAt: Date.now(),
  })
}

/** Asks for notification permission and stores this device's push token. */
export async function enablePush(hid: string, uid: string): Promise<PushResult> {
  const native = await nativePushRegister()
  if (native) {
    await saveToken(hid, uid, native, 'android')
    return 'enabled'
  }
  if (isIos() && !isStandalone()) return 'needsInstall'
  if (!(await isSupported())) return 'unsupported'
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (usingEmulators || !vapidKey) return 'notConfigured'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(firebaseConfig))}`,
  )
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg })
  await saveToken(hid, uid, token, 'web')
  return 'enabled'
}
