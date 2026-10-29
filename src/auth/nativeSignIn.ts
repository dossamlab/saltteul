import { Capacitor } from '@capacitor/core'
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { auth } from '../firebase'

// On Android, sign in with the native Google account picker. The native Firebase SDK is signed in too
// (skipNativeAuth: false), which the home screen widgets rely on to read the household data.
// Returns true when it handled sign-in, false to fall back to the web popup.
export async function nativeSignIn(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const result = await FirebaseAuthentication.signInWithGoogle()
  const idToken = result.credential?.idToken
  if (!idToken) throw new Error('google sign-in returned no id token')
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
  return true
}

export async function nativeSignOut(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  await FirebaseAuthentication.signOut()
}
