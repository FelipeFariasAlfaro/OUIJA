import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Settings } from '@shared/ipc'
import type { Lang } from '@shared/types'
import { LANG_IDS, LANG_INFO, langFromLocale } from '@shared/langs'
import type { AiConfig } from '@shared/ai'
import { api } from '../api'
import AiWizard from '../ai/AiWizard'
import Storm from './Storm'
import WindowControls from '../components/WindowControls'
import { GhostIcon } from '../components/ui'
import { I18nContext, makeI18n } from '../i18n'
import SetupStep from './SetupStep'
import { GhostsArt, PrivacyArt, ResurrectArt, SearchArt } from './SlideArt'

const SLIDES: { art: () => ReactNode; title: 'slide1Title' | 'slide2Title' | 'slide3Title' | 'slide4Title'; text: 'slide1Text' | 'slide2Text' | 'slide3Text' | 'slide4Text' }[] = [
  { art: SearchArt, title: 'slide1Title', text: 'slide1Text' },
  { art: ResurrectArt, title: 'slide2Title', text: 'slide2Text' },
  { art: GhostsArt, title: 'slide3Title', text: 'slide3Text' },
  { art: PrivacyArt, title: 'slide4Title', text: 'slide4Text' }
]

/** Pasos: 0 = idioma, 1..4 = diapositivas, 5 = modelo de lenguaje, 6 = puesta en marcha. */
const LAST_SLIDE = SLIDES.length
const AI = LAST_SLIDE + 1
const SETUP = LAST_SLIDE + 2

const LANGS = LANG_IDS.map((id) => ({ id, ...LANG_INFO[id] }))
const detectLang = (): Lang => langFromLocale(navigator.language)

/** Bienvenida de la primera vez: idioma, cómo funciona y puesta en marcha. */
export default function Onboarding({ settings, onDone }: { settings: Settings; onDone: (s: Settings) => void }) {
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState<Lang>(settings.lang ?? detectLang())
  const [direction, setDirection] = useState(1)
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null)
  const i18n = useMemo(() => makeI18n(lang), [lang])
  const { t } = i18n

  const go = (next: number) => {
    setDirection(next >= step ? 1 : -1)
    setStep(Math.max(0, Math.min(SETUP, next)))
    if (next === AI) void api.aiConfig().then(setAiConfig)
  }

  const choose = (id: Lang) => {
    setLang(id)
    void api.setSettings({ lang: id })
  }

  useEffect(() => {
    // Se guarda el idioma ofrecido por defecto para que el resto de la aplicación coincida.
    void api.setSettings({ lang })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (step === SETUP || step === AI) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (document.activeElement?.tagName === 'BUTTON' && e.key === 'Enter') return
        go(step + 1)
      }
      if (e.key === 'ArrowLeft' && step > 0) go(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const slide = step >= 1 && step <= LAST_SLIDE ? SLIDES[step - 1] : null
  const Art = slide?.art

  return (
    <I18nContext.Provider value={i18n}>
      <div
        className="relative flex h-full flex-col overflow-hidden bg-[#08070d]"
        style={{
          backgroundImage: 'radial-gradient(600px 260px at 50% -80px, rgba(139,92,246,.28), transparent 70%), radial-gradient(420px 220px at 100% 100%, rgba(99,102,241,.12), transparent 70%)'
        }}
      >
        <Storm />
        <header className="relative z-10 flex items-center px-4 pb-2 pt-3.5 [-webkit-app-region:drag]">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-200">
            <GhostIcon className="h-5 w-5" /> OUIJA
          </div>
          <div className="ml-auto">
            <WindowControls />
          </div>
        </header>

        {step === 0 && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-8">
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
              <GhostIcon className="h-20 w-20 text-violet-300 drop-shadow-[0_0_28px_rgba(167,139,250,.55)]" />
            </motion.div>
            <h1 className="mt-4 text-2xl font-semibold text-zinc-50">{t.welcomeTitle}</h1>
            <p className="mt-1 text-sm text-zinc-400">{t.welcomeSub}</p>
            <div className="mt-6 grid w-full max-w-xl grid-cols-3 gap-3" role="radiogroup" aria-label="Idioma / Language">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={lang === l.id}
                  onClick={() => choose(l.id)}
                  lang={LANG_INFO[l.id].locale}
                  className={`rounded-2xl border px-4 py-4 text-left transition-colors ${lang === l.id ? 'border-violet-400/60 bg-violet-400/10' : 'border-white/10 hover:bg-white/[0.04]'}`}
                >
                  <div className="text-lg font-semibold text-zinc-100">{l.name}</div>
                  <div className="mt-0.5 text-[12px] text-zinc-500">{l.hint}</div>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => go(1)} className="mt-6 rounded-lg bg-violet-500 px-6 py-2 text-sm font-medium text-white hover:bg-violet-400">
              {t.continue}
            </button>
          </div>
        )}

        {slide && Art && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col px-8 pb-5">
            <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  initial={{ opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -40 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col items-center text-center"
                >
                  <div className="flex h-[190px] items-center justify-center">
                    <Art />
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-zinc-50">{t[slide.title] as string}</h2>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-400">{t[slide.text] as string}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center">
              <button type="button" onClick={() => go(step - 1)} className="w-24 text-left text-sm text-zinc-400 hover:text-zinc-200">
                ← {t.back}
              </button>
              <div className="flex flex-1 justify-center gap-2" role="tablist">
                {SLIDES.map((_, i) => (
                  <button key={i} type="button" role="tab" aria-selected={step === i + 1} aria-label={`${i + 1}`} onClick={() => go(i + 1)} className={`h-2 rounded-full transition-all ${step === i + 1 ? 'w-6 bg-violet-400' : 'w-2 bg-white/20 hover:bg-white/40'}`} />
                ))}
              </div>
              <div className="flex w-24 items-center justify-end gap-3">
                {step < LAST_SLIDE && (
                  <button type="button" onClick={() => go(AI)} className="text-[12px] text-zinc-500 hover:text-zinc-300">
                    {t.skip}
                  </button>
                )}
                <button type="button" onClick={() => go(step + 1)} className="rounded-lg bg-violet-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-400">
                  {step === LAST_SLIDE ? t.continue : t.next}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === AI && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col px-8 pb-5 pt-1">
            {aiConfig && (
              <AiWizard
                centered
                heading={<h2 className="mb-1 text-xl font-semibold text-zinc-100">{t.aiTitle}</h2>}
                config={aiConfig}
                onSaved={() => go(SETUP)}
                onLater={() => go(SETUP)}
                onCancel={() => go(LAST_SLIDE)}
              />
            )}
          </div>
        )}

        {step === SETUP && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            <SetupStep settings={settings} onFinish={onDone} />
          </div>
        )}
      </div>
    </I18nContext.Provider>
  )
}
