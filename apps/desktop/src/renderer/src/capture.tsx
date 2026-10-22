import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CaptureComposer } from './components/CaptureComposer'
import { useTheme } from './hooks/useTheme'
import type { AppSettings } from '../../shared/ipc.js'
import './styles/app.css'

function CaptureApp(): React.ReactNode {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState<AppSettings['theme']>()

  // Yakalama penceresi de aynı temayı kullanır — ana pencere koyu, bu beyaz
  // olursa uygulama iki parçaya bölünmüş gibi görünür.
  useEffect(() => {
    void window.devlog.settings().then((settings) => setTheme(settings.theme))
  }, [])
  useTheme(theme)

  const submit = async (text: string, openMain: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    const outcome = await window.devlog.capture.submit(text)
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    if (openMain) window.devlog.capture.openMain(outcome.id)
    else window.devlog.capture.close()
  }

  return (
    <div className="p-3">
      <CaptureComposer
        onSubmit={submit}
        onClose={() => window.devlog.capture.close()}
        onHeightChange={(height) => window.devlog.capture.resize(height)}
        busy={busy}
        error={error}
      />
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <CaptureApp />
  </StrictMode>,
)
