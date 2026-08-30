// Small shared presentational helpers used across both dashboards.
// Composed by nearly every page, so dark-mode support lives here once
// rather than being repeated across every page-specific className.

export function bandColor(score) {
  if (score >= 75) return '#16a34a'   // safe - green
  if (score >= 50) return '#eab308'   // moderate - amber
  if (score >= 25) return '#f97316'   // risky - orange
  return '#dc2626'                    // danger - red
}

export function bandLabel(score) {
  if (score >= 75) return 'Safe'
  if (score >= 50) return 'Moderate'
  if (score >= 25) return 'Risky'
  return 'Danger'
}

const SEV = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
}

export function SeverityBadge({ severity }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEV[severity] || SEV.medium}`}>
      {severity}
    </span>
  )
}

export function StatusBadge({ status }) {
  const map = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
    sos: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 sos-pulse',
    missing: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
    detected: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
    acknowledged: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
    dispatched: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
    resolved: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
    // escalation stages -- each hop up is more alarming, control_room being
    // the calmest (still open, nobody notified yet) and responder_dispatch
    // the most urgent unacknowledged state before it's finally acknowledged.
    control_room: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    emergency_contact: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
    responder_dispatch: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>
      {status}
    </span>
  )
}

export function ScoreGauge({ score, size = 120 }) {
  const r = size / 2 - 10
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  const color = bandColor(score)
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor"
          className="text-slate-200 dark:text-slate-700" strokeWidth="10" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .6s ease, stroke .6s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-bold" style={{ color }}>{Math.round(score)}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{bandLabel(score)}</div>
      </div>
    </div>
  )
}

export function Stat({ label, value, accent = 'text-slate-900 dark:text-slate-100' }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
    </div>
  )
}

export function Card({ title, children, actions }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm">
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          {actions}
        </div>
      )}
      <div className="p-4 text-slate-700 dark:text-slate-200">{children}</div>
    </div>
  )
}
