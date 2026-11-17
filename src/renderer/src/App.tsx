import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { IndexState, Settings } from '@shared/ipc'
import { AI_PROVIDERS } from '@shared/ai'
import { api } from './api'
import { GhostIcon } from './components/ui'
import Ambience from './components/Ambience'
import AboutModal from './components/AboutModal'
import Tour from './components/Tour'
import UpdateBanner from './components/UpdateBanner'
import WindowControls from './components/WindowControls'
import { I18nContext, makeI18n, type Lang } from './i18n'
import CryptView from './views/CryptView'
import GallowsView from './views/GallowsView'
import GhostsView from './views/GhostsView'
import PeopleView from './views/PeopleView'
import Onboarding from './onboarding/Onboarding'
import SearchView from './views/SearchView'
import SettingsView from './views/SettingsView'

type View = 'search' | 'ghosts' | 'people' | 'crypt' | 'gallows' | 'settings'
const VIEWS: View[] = ['search', 'ghosts', 'people', 'crypt', 'gallows', 'settings']

/** Monta la vista en cuanto se visita y la oculta (sin desmontarla) al cambiar de pestaña. */
function Pane({ id, view, visited, children }: { id: View; view: View; visited: ReadonlySet<View>; children: ReactNode }) {
  if (view !== id && !visited.has(id)) return null
  return <div className={view === id ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>{children}</div>
}

const IDLE: IndexState = { phase: 'idle', processed: 0, total: 0, indexed: 0, skipped: 0, errors: 0 }

export default function App() {
  const [view, setView] = useState<View>('search')
  const [visited, setVisited] = useState<ReadonlySet<View>>(new Set(['search']))
  useEffect(() => {
    setVisited((v) => (v.has(view) ? v : new Set(v).add(view)))
  }, [view])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [index, setIndex] = useState<IndexState>(IDLE)
  const [touring, setTouring] = useState(false)
  const [about, setAbout] = useState(false)
  const [version, setVersion] = useState<string | undefined>()
  useEffect(() => {
    void api.appInfo().then((i) => setVersion(i.version)).catch(() => undefined)
  }, [])
  const lang: Lang = settings?.lang ?? 'es'
  const i18n = useMemo(() => makeI18n(lang), [lang])
  const { t } = i18n

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.indexState().then(setIndex)
    return api.onIndexState(setIndex)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.minimize()
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault()
        setView(VIEWS[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // El recorrido se muestra una vez, al terminar la bienvenida (con un respiro para que aparezca el contador).
  useEffect(() => {
    if (!settings?.onboarded || settings.tourDone) return
    const timer = setTimeout(() => {
      setView('search')
      setTouring(true)
    }, 900)
    return () => clearTimeout(timer)
  }, [settings?.onboarded, settings?.tourDone])
  const endTour = useCallback(() => {
    setTouring(false)
    void api.setSettings({ tourDone: true }).then(setSettings)
  }, [])
  const startTour = useCallback(() => {
    setView('search')
    setTouring(true)
  }, [])

  const addFolder = useCallback(() => void api.addFolder().then(setSettings), [])

  const tabs: { id: View; label: string }[] = [
    { id: 'search', label: t.tabSearch },
    { id: 'ghosts', label: t.tabGhosts },
    { id: 'people', label: t.tabPeople },
    { id: 'crypt', label: t.tabCrypt },
    { id: 'gallows', label: t.tabGallows },
    { id: 'settings', label: t.tabSettings }
  ]
  const busy = index.phase === 'scanning' || index.phase === 'indexing' || index.phase === 'reading' || index.phase === 'entities'

  if (settings && !settings.onboarded) {
    return (
      <Onboarding
        settings={settings}
        onDone={(s) => {
          setSettings(s)
          setView('search')
        }}
      />
    )
  }

  return (
    <I18nContext.Provider value={i18n}>
      <div
        className="relative isolate flex h-full flex-col overflow-hidden bg-[#0d0d16]"
        style={{
          backgroundImage:
            'radial-gradient(600px 220px at 50% -60px, rgba(139,92,246,.22), transparent 70%), radial-gradient(400px 200px at 100% 100%, rgba(99,102,241,.10), transparent 70%)'
        }}
      >
        {settings?.ambience !== false && <Ambience />}
        <header onDoubleClick={(e) => e.target === e.currentTarget && api.toggleMaximize()} className="mb-2 flex items-center gap-1 px-4 pb-3 pt-3.5 [-webkit-app-region:drag]">
          <div className="mr-3 flex items-center gap-2 text-sm font-semibold text-violet-200">
            <GhostIcon className="h-5 w-5" /> OUIJA
          </div>
          <nav className="flex gap-1 [-webkit-app-region:no-drag]" aria-label="Vistas">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-tour={`tab-${tab.id}`}
                onClick={() => setView(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === tab.id ? 'bg-violet-400/15 text-violet-200' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setAbout(true)}
            title={t.aboutHelp}
            aria-label={t.aboutHelp}
            className="ml-2 flex h-6 w-6 items-center justify-center rounded-full [-webkit-app-region:no-drag] border border-white/15 text-[11px] font-semibold text-zinc-400 transition-colors hover:border-rose-400/60 hover:text-rose-200 hover:shadow-[0_0_12px_rgba(244,63,94,.45)]"
          >
            ?
          </button>
          <div className="ml-auto flex items-center gap-3">
            {busy && (
              <button type="button" data-tour="progress" onClick={() => setView('settings')} className="flex items-center gap-1.5 rounded-full bg-violet-400/10 px-2 py-0.5 text-[11px] text-violet-200 [-webkit-app-region:no-drag]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" />
                {index.total > 0 ? `${index.processed}/${index.total}` : '…'}
              </button>
            )}
            {settings?.ai.mode === 'remote' && settings.ai.provider ? (
              <button
                type="button"
                data-tour="local"
                onClick={() => setView('settings')}
                title={t.remoteBadgeHelp}
                className="flex items-center gap-1.5 text-[11px] text-zinc-400 [-webkit-app-region:no-drag] hover:text-zinc-200"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                {t.remoteBadge(AI_PROVIDERS[settings.ai.provider].name)}
              </button>
            ) : (
              <span data-tour="local" className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t.localBadge}
              </span>
            )}
            <WindowControls />
          </div>
        </header>

        <UpdateBanner />

        {/* Las pestañas visitadas siguen montadas (ocultas) para conservar búsqueda, selección y filtros. */}
        <Pane id="search" view={view} visited={visited}>
          <SearchView key={lang} hasFolders={(settings?.folders.length ?? 0) > 0 || index.indexed > 0} onAddFolder={addFolder} changesKey={`${index.phase}-${index.indexed}`} onGallows={() => setView('gallows')} />
        </Pane>
        <Pane id="ghosts" view={view} visited={visited}>
          <GhostsView key={lang} refreshKey={`${index.phase}`} />
        </Pane>
        <Pane id="people" view={view} visited={visited}>
          <PeopleView key={lang} refreshKey={`${index.phase}`} />
        </Pane>
        <Pane id="crypt" view={view} visited={visited}>
          <CryptView key={lang} refreshKey={`${index.phase}-${index.indexed}`} indexing={busy} onSettings={() => setView('settings')} />
        </Pane>
        <Pane id="gallows" view={view} visited={visited}>
          <GallowsView key={lang} />
        </Pane>
        {view === 'settings' && settings && <SettingsView settings={settings} index={index} onSettings={setSettings} onTour={startTour} />}

        {touring && <Tour onDone={endTour} />}
        <AnimatePresence>{about && <AboutModal version={version} onClose={() => setAbout(false)} />}</AnimatePresence>

        <footer className="flex items-center gap-4 border-t border-white/5 px-4 py-2 text-[11px] text-zinc-500">
          <span>
            <kbd className="rounded bg-white/5 px-1">↑↓</kbd> {t.hintNav}
          </span>
          <span>
            <kbd className="rounded bg-white/5 px-1">Enter</kbd> {t.hintOpen}
          </span>
          <span>
            <kbd className="rounded bg-white/5 px-1">Esc</kbd> {t.hintHide}
          </span>
        </footer>
      </div>
    </I18nContext.Provider>
  )
}
