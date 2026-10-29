import { Loader2, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../copy'
import { transcribe } from '../data/actions'
import { startRecording, voiceSupported, VoiceError, type Recording } from '../voice/recorder'

type VoiceState = 'idle' | 'recording' | 'working'

function voiceMessage(e: unknown): string {
  if (e instanceof VoiceError) return t(e.code === 'denied' ? 'voice.denied' : e.code === 'silent' ? 'voice.silent' : 'voice.failed')
  return t('voice.failed')
}

/**
 * Tap to record, tap again to stop (or it stops itself at 30 s). The recognised text is handed to `onText`, which only
 * fills the field; the user still presses 「정리」. Hidden where the browser cannot record.
 */
export function VoiceButton({ onText, onStatus, size = 'md' }: {
  onText: (text: string) => void
  /** Short status line for the caller to show ('' clears it). */
  onStatus: (text: string, tone: 'info' | 'error') => void
  size?: 'sm' | 'md'
}) {
  const [state, setState] = useState<VoiceState>('idle')
  const [level, setLevel] = useState(0)
  const rec = useRef<Recording | null>(null)
  const alive = useRef(true)
  const supported = useRef(voiceSupported()).current

  useEffect(() => () => {
    alive.current = false
    rec.current?.cancel()
  }, [])

  if (!supported) return null

  const finish = async () => {
    const r = rec.current
    if (!r) return
    rec.current = null
    setState('working')
    onStatus(t('voice.working'), 'info')
    try {
      const audio = await r.stop()
      const { data } = await transcribe(audio)
      if (!alive.current) return
      if (data.text.trim()) {
        onText(data.text.trim())
        onStatus('', 'info')
      } else {
        onStatus(t('voice.silent'), 'error')
      }
    } catch (e) {
      if (alive.current) onStatus(voiceMessage(e), 'error')
    } finally {
      if (alive.current) {
        setState('idle')
        setLevel(0)
      }
    }
  }

  const start = async () => {
    onStatus(t('voice.listening'), 'info')
    setState('recording')
    try {
      rec.current = await startRecording({
        onLevel: (v) => alive.current && setLevel(v),
        onLimit: () => void finish(),
      })
    } catch (e) {
      rec.current = null
      setState('idle')
      onStatus(voiceMessage(e), 'error')
    }
  }

  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  const recording = state === 'recording'
  return (
    <button type="button" aria-label={t(recording ? 'voice.stop' : 'voice.start')} title={t(recording ? 'voice.stop' : 'voice.start')}
      aria-pressed={recording} disabled={state === 'working'}
      onClick={() => (recording ? void finish() : void start())}
      className={`relative grid ${box} shrink-0 place-items-center rounded-full transition-colors disabled:opacity-60 ${
        recording ? 'bg-terra text-white' : 'bg-muted text-ink-2 hover:text-ink'
      }`}>
      {recording && (
        <span aria-hidden className="absolute inset-0 rounded-full bg-terra/40"
          style={{ transform: `scale(${1 + Math.min(level * 3, 0.45)})`, transition: 'transform 90ms linear' }} />
      )}
      <span className="relative">
        {state === 'working' ? <Loader2 size={18} className="animate-spin" /> : recording ? <Square size={16} fill="currentColor" /> : <Mic size={18} />}
      </span>
    </button>
  )
}
