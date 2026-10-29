import { GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '../../shared/types'
import { auth, functions, usingEmulators } from '../firebase'
import { nativeSignIn, nativeSignOut } from './nativeSignIn'

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'notAllowed'; email: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; user: User; hid: string; role: Role }

const Ctx = createContext<SessionState>({ status: 'loading' })

export function useSession() {
  return useContext(Ctx)
}

export function useReadySession() {
  const s = useSession()
  if (s.status !== 'ready') throw new Error('session not ready')
  return s
}

export async function signIn() {
  if (await nativeSignIn()) return
  await signInWithPopup(auth, new GoogleAuthProvider())
}

export async function logOut() {
  await nativeSignOut()
  await signOut(auth)
}

// Local emulator only: lets tests and the developer sign in as the seeded example accounts.
if (usingEmulators) {
  ;(window as unknown as { __devSignIn?: (email: string) => Promise<unknown> }).__devSignIn = (email: string) =>
    signInWithEmailAndPassword(auth, email, 'saltteul-dev')
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return setState({ status: 'signedOut' })
        setState({ status: 'loading' })
        try {
          const join = httpsCallable<unknown, { hid: string; role: Role }>(functions, 'joinHousehold')
          const { data } = await join({})
          setState({ status: 'ready', user, hid: data.hid, role: data.role })
        } catch (e) {
          const code = (e as { code?: string }).code ?? ''
          if (code.endsWith('permission-denied')) setState({ status: 'notAllowed', email: user.email ?? '' })
          else setState({ status: 'error', message: String((e as Error).message ?? e) })
        }
      }),
    [],
  )

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
