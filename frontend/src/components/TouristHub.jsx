import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher.jsx'
import ThemeToggle from './ThemeToggle.jsx'

const CARDS = [
  { key: 'profile', icon: '👤', title: 'Profile', body: 'View and update your details.', target: '#hub-profile' },
  { key: 'wearable', icon: '⌚', title: 'Wearable & Emergency Contacts', body: 'Connect devices and manage your emergency numbers.', target: '#hub-profile' },
  { key: 'map', icon: '🗺️', title: 'Map', body: 'Track your location and nearby safe zones.', target: '#hub-map' },
  { key: 'report', icon: '📝', title: 'Report', body: 'Report an incident online.', target: '#hub-report' },
  { key: 'ask-ai', icon: '💬', title: 'Ask AI', body: 'Get real-time AI assistance.', action: 'copilot' },
  { key: 'incident-ai', icon: '🚨', title: 'Incident Response System using AI', body: 'AI-powered analysis and response for incidents.', target: '#hub-incident-ai' },
]

// The tourist app's opening screen -- a dark-themed hub mirroring the
// project's dashboard reference: a one-tap SOS circle up top, and a grid of
// cards to the real sections below (each `target` is an anchor already
// rendered further down the page; "Ask AI" instead opens the shared
// CopilotChat widget via its imperative ref). Nothing here is a separate
// screen -- it's the top of the same scrollable app, so every card just
// jumps to a real, already-functional part of it.
export default function TouristHub({ digitalId, onSOS, onAskAI, topBarExtra }) {
  const { t } = useTranslation()

  const go = (card) => {
    if (card.action === 'copilot') {
      onAskAI?.()
      return
    }
    document.querySelector(card.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="tourist-hub">
      <style>{`
        .tourist-hub { background: #04070d; color: #e6f1ff; }
        .hub-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
        .hub-card:hover { border-color: rgba(34,211,238,0.45); background: rgba(255,255,255,0.06); }
        .hub-sos { border-radius: 50%; width: 168px; height: 168px;
          background: radial-gradient(circle at 35% 30%, #f87171, #dc2626 60%, #7f1d1d 100%);
          box-shadow: 0 0 50px rgba(220,38,38,0.55); }
        .hub-sos:active { transform: scale(0.97); }
      `}</style>

      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <div>
          <div className="text-xs opacity-70">{t('app.digital_id')}</div>
          <div className="font-bold tracking-wide">{digitalId}</div>
        </div>
        <div className="flex items-center gap-2">
          {topBarExtra}
          <LanguageSwitcher className="!border-slate-600 !text-slate-200 !bg-transparent" />
          <ThemeToggle className="!border-slate-600 !text-slate-200 !bg-transparent" />
        </div>
      </div>

      <div className="flex justify-center py-8">
        <button onClick={onSOS} title={t('sos.button')}
          className="hub-sos flex items-center justify-center font-extrabold text-2xl tracking-wide text-white sos-pulse transition-transform">
          SOS
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 px-5 pb-8 max-w-4xl mx-auto">
        {CARDS.map((c) => (
          <button key={c.key} onClick={() => go(c)}
            className="hub-card rounded-2xl p-5 text-left transition">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{c.icon}</span>
              <span className="font-semibold">{c.title}</span>
            </div>
            <p className="text-xs text-slate-400">{c.body}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
