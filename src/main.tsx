import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SessionProvider } from './auth/session'
import { installNativeOpen } from './native/open'
import { startLiveUpdate } from './pwa/liveUpdate'
import './theme.css'

// First, so a widget tap that arrives while the app is still starting is kept for the screen.
installNativeOpen()
startLiveUpdate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
)
