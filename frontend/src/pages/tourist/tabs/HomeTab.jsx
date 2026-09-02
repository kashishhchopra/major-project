import { MapContainer, TileLayer, Marker, Polygon } from 'react-leaflet'
import { useTranslation } from 'react-i18next'
import { ScoreGauge } from '../../../components/ui.jsx'
import { touristIcon, policeIcon, riskColor } from '../../../components/mapIcons'
import ScoreExplanation from '../../../components/ScoreExplanation.jsx'
import TrajectoryOverlay from '../../../components/TrajectoryOverlay.jsx'
import { RouteLayer } from '../../../components/RoutePicker.jsx'
import DisasterBanner from '../../../components/DisasterBanner.jsx'

// Quick-action row: the handful of things a tourist reaches for constantly,
// one tap away from the home screen, without cluttering it with full panels
// -- each button either opens the relevant tool in place (SOS, voice
// assistant) or jumps to the tab that has it (Plan/Help), so nothing here
// duplicates functionality that already lives elsewhere.
const QUICK_ACTIONS = [
  { key: 'sos', icon: '🆘', label: 'Emergency' },
  { key: 'voice', icon: '🎙️', label: 'Voice' },
  { key: 'nav', icon: '🗺️', label: 'Navigate' },
  { key: 'hospital', icon: '🏥', label: 'Hospital' },
  { key: 'pharmacy', icon: '💊', label: 'Pharmacy' },
  { key: 'transport', icon: '🚕', label: 'Transport' },
  { key: 'translate', icon: '🌐', label: 'Translate' },
  { key: 'itinerary', icon: '📄', label: 'Itinerary' },
]

function QuickActions({ onSOS, onVoice, onNavigateTab, setRoutePickerOpen }) {
  const go = (key) => {
    switch (key) {
      case 'sos': onSOS(); break
      case 'voice': onVoice(); break
      case 'nav': setRoutePickerOpen(true); onNavigateTab('plan'); break
      case 'hospital': case 'pharmacy': case 'transport': case 'translate':
        onNavigateTab('help'); break
      case 'itinerary': onNavigateTab('plan'); break
      default: break
    }
  }
  return (
    <div className="grid grid-cols-4 gap-2">
      {QUICK_ACTIONS.map((a) => (
        <button key={a.key} onClick={() => go(a.key)}
          className={`flex flex-col items-center gap-1 rounded-xl py-2.5 text-xs font-medium ${
            a.key === 'sos'
              ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 shadow-sm'}`}>
          <span className="text-lg leading-none">{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  )
}

// The calm default screen: map, safety score, and the geofence/disaster
// state a tourist needs at a glance -- everything else moved to its own tab.
export default function HomeTab({ data, onVoice, onNavigateTab }) {
  const { t } = useTranslation()
  const { me, score, zones, trajectory, nearby, riskyZone, routePicker, routePickerOpen,
    setRoutePickerOpen, tid, sendSOS } = data

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-4 flex items-center gap-4">
        <ScoreGauge score={score.score} />
        <div>
          <div className="text-sm text-slate-500 dark:text-slate-400">{t('safety.my_score')}</div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{me.full_name}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('safety.zone')}: {score.breakdown.zone}<br />
            {score.breakdown.night_penalty ? `🌙 ${t('safety.night_caution')}` : `☀️ ${t('safety.daytime')}`}
          </div>
          <ScoreExplanation explanation={score.breakdown.explanation} />
        </div>
      </div>

      {/* Simple, non-technical status line -- the detailed score breakdown
          above is enough for anyone who wants more; this line is for
          anyone who just wants a yes/no at a glance. */}
      <div className={`text-sm font-semibold rounded-xl px-4 py-2 ${
        riskyZone ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                  : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
        {riskyZone ? '● Caution — elevated risk area' : '● Safety Status: Normal'}
      </div>

      <QuickActions onSOS={sendSOS} onVoice={onVoice} onNavigateTab={onNavigateTab}
        setRoutePickerOpen={setRoutePickerOpen} />

      <DisasterBanner touristId={tid} />

      {riskyZone ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="font-semibold text-red-700">⚠ {t('geofence.warning_title')}</div>
          <div className="text-sm text-red-600 mt-1">
            {t('geofence.warning_body', { zone: riskyZone.name, risk: riskyZone.risk_level })}
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">
          ✅ {t('geofence.safe')}
        </div>
      )}

      {routePickerOpen && (
        <div className="bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800 rounded-xl p-3 text-xs text-sky-700 dark:text-sky-300">
          🧭 Tap the map below to choose a destination, then go to the Plan tab to find a safe route.
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm overflow-hidden" style={{ height: 320 }}>
        <MapContainer center={[me.last_lat, me.last_lng]} zoom={14} style={{ height: '100%' }} key={me.id}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
          {zones.map((z) => (
            <Polygon key={z.id} positions={z.polygon}
              pathOptions={{ color: riskColor[z.risk_level], fillOpacity: 0.15, weight: 1.5 }} />
          ))}
          <Marker position={[me.last_lat, me.last_lng]} icon={touristIcon(score.score)} />
          {nearby.map((u) => <Marker key={u.id} position={[u.lat, u.lng]} icon={policeIcon} />)}
          <TrajectoryOverlay points={trajectory} />
          <RouteLayer active={routePickerOpen} dest={routePicker.dest}
            result={routePicker.result} onPick={routePicker.pick} />
        </MapContainer>
      </div>
    </div>
  )
}
