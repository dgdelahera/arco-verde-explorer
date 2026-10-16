import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './App.css'
import App from './App.tsx'
import { OfflineBanner } from './OfflineBanner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OfflineBanner />
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
