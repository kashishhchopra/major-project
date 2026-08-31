const TABS = [
  { key: 'home', icon: '🗺️', label: 'Home' },
  { key: 'plan', icon: '🧭', label: 'Plan' },
  { key: 'help', icon: '🏥', label: 'Help' },
  { key: 'me', icon: '👤', label: 'Me' },
]

// Persistent bottom navigation for the tourist app. Kept separate from the
// SOS button (rendered by TouristShell above this) so the single most
// important action on the whole screen is never one of five equal-weight
// tab buttons.
export default function TouristTabBar({ active, onChange }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[1000] bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 pb-[env(safe-area-inset-bottom)]"
      aria-label="Tourist app sections"
    >
      <div className="max-w-md mx-auto grid grid-cols-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            aria-current={active === tab.key ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors ${
              active === tab.key
                ? 'text-sky-600 dark:text-sky-400'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            <span className="text-lg leading-none">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

export { TABS }
