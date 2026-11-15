import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { isDesktop } from './api'
import { makeI18n } from './i18n'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDesktop ? (
      <App />
    ) : (
      <main className="flex h-full items-center justify-center p-8 text-center text-sm text-zinc-400">{makeI18n(navigator.language.startsWith('en') ? 'en' : 'es').t.notDesktop}</main>
    )}
  </StrictMode>
)
