import { Capacitor } from '@capacitor/core'

// Returns this Android device's FCM token after asking for permission, or null on the web.
export async function nativePushRegister(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')
  const perm = await FirebaseMessaging.requestPermissions()
  if (perm.receive !== 'granted') return null
  const { token } = await FirebaseMessaging.getToken()
  return token
}
