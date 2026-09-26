import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// StrictMode is intentionally off: the round orchestrator drives timed
// cinematics and audio, which double-invoked effects would fire twice.
createRoot(document.getElementById('root')!).render(<App />)
