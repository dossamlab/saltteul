import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'kr.saltteul.app',
  appName: '살뜰',
  webDir: 'dist',
  android: { backgroundColor: '#faf9f6' },
  plugins: {
    FirebaseAuthentication: { skipNativeAuth: false, providers: ['google.com'] },
    FirebaseMessaging: { presentationOptions: ['badge', 'sound', 'alert'] },
    // Manual live updates from our own web host (src/pwa/liveUpdate.ts); nothing goes to Capgo's servers.
    CapacitorUpdater: { autoUpdate: false, updateUrl: '', channelUrl: '', statsUrl: '', appReadyTimeout: 15000 },
  },
}

export default config
