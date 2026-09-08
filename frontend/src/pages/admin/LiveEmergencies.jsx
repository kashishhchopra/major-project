import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import useWebSocket from '../../useWebSocket'
import { listLiveEmergencies } from '../../lib/emergencyLocationService'
import { sosIcon } from '../../components/mapIcons'

const STATUS_META = {
  live: { label: '🟢 LIVE', cls: 'bg-emerald-100 text-emerald-700' },
  stale: { label: '🟡 STALE', cls: 'bg-amber-100 text-amber-700' },
  offline: { label: '🔴 OFFLINE', cls: 'bg-red-100 text-red-700' },
  no_data: { label: '⚪ NO DATA', cls: 'bg-slate-100 text-slate-500' },
}

function timeAgo(seconds) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${Math.round(seconds)} sec ago`
  return `${Math.round(seconds / 60)} min ago`
}

// Central Safety Dashboard's live-emergency view -- see
// backend/app/services/emergency_location.py. GPS -> backend (real) ->
// this page (real-time via the same admin WebSocket feed every other live
// dashboard already uses) -> live map. A card's own position marker moves
// as soon as an `emergency_location` event arrives for its incident; no
// polling needed while the socket is connected (list refresh on load/new
// incident still uses a plain fetch).
export default function LiveEmergencies() {
  const [emergencies, setEmergencies] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    listLiveEmergencies()
      .then((data) => { setEmergencies(data); setError('') })
      .catch(() => setError('Could not load live emergencies right now.'))
  }
  useEffect(load, [])

  // Live position updates without a full re-fetch: patch just the affected
  // incident's `latest`/`trail`/`location_status` in place.
  useWebSocket((msg) => {
    if (msg.event === 'emergency_location') {
      setEmergencies((list) => list.map((e) => (
        e.incident_id === msg.incident_id
          ? {
              ...e,
              latest: { lat: msg.lat, lng: msg.lng, accuracy_m: msg.accuracy_m,
                       speed_kmh: msg.speed_kmh, heading_deg: msg.heading_deg,
                       timestamp: msg.timestamp, anomaly_flag: msg.anomaly_flag, demo: msg.demo },
              trail: [...e.trail, { lat: msg.lat, lng: msg.lng }].slice(-60),
              location_status: 'live', seconds_since_update: 0,
            }
          : e
      )))
    } else if (msg.event === 'emergency_tracking_stopped') {
      setEmergencies((list) => list.filter((e) => e.incident_id !== msg.incident_id))
    } else if (msg.event === 'incident') {
      load() // a fresh SOS -- pick up the new live-tracking incident
    }
  })

  // Recompute LIVE -> STALE -> OFFLINE locally between socket pushes, same
  // thresholds the backend uses, so a card never keeps claiming LIVE once
  // updates have actually stopped arriving.
  useEffect(() => {
    const iv = setInterval(() => {
      setEmergencies((list) => list.map((e) => {
        if (!e.latest) return e
        const age = (Date.now() - new Date(e.latest.timestamp).getTime()) / 1000
        const status = age <= 15 ? 'live' : age <= 45 ? 'stale' : 'offline'
        return { ...e, location_status: status, seconds_since_update: age }
      }))
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  const selected = emergencies.find((e) => e.incident_id === selectedId) || emergencies[0]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">🚨 Live Emergencies</h1>
        <span className="text-xs text-slate-400">{emergencies.length} active</span>
      </div>

      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      {!error && emergencies.length === 0 && (
        <div className="text-sm text-slate-400 bg-white dark:bg-slate-800 rounded-xl p-6 text-center">
          No active emergencies right now.
        </div>
      )}

      {emergencies.length > 0 && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto">
            {emergencies.map((e) => {
              const meta = STATUS_META[e.location_status] || STATUS_META.no_data
              return (
                <button key={e.incident_id} onClick={() => setSelectedId(e.incident_id)}
                  className={`w-full text-left bg-white dark:bg-slate-800 rounded-xl p-3 text-sm border-2 ${
                    selected?.incident_id === e.incident_id ? 'border-red-500' : 'border-transparent'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">🚨 INC-{e.incident_id}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Tourist: {e.digital_id || e.tourist_name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Station: {e.station_name || 'Unassigned'}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Updated {timeAgo(e.seconds_since_update)}
                    {e.latest?.accuracy_m != null && ` · ±${Math.round(e.latest.accuracy_m)} m`}
                    {e.latest?.demo && ' · demo'}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="md:col-span-2 bg-white dark:bg-slate-800 rounded-xl overflow-hidden" style={{ height: 500 }}>
            {selected?.latest ? (
              <MapContainer center={[selected.latest.lat, selected.latest.lng]} zoom={15}
              className="map-ops-dark"
                style={{ height: '100%' }} key={selected.incident_id}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                <Marker position={[selected.latest.lat, selected.latest.lng]} icon={sosIcon}>
                  <Popup>
                    <div className="text-xs">
                      <div className="font-bold">INC-{selected.incident_id}</div>
                      <div>Tourist: {selected.digital_id}</div>
                      <div>Accuracy: ±{Math.round(selected.latest.accuracy_m || 0)} m</div>
                      {selected.latest.speed_kmh != null && <div>Speed: {selected.latest.speed_kmh.toFixed(1)} km/h</div>}
                      {selected.latest.anomaly_flag && <div className="text-orange-600 font-semibold">⚠ Location anomaly detected</div>}
                    </div>
                  </Popup>
                </Marker>
                {selected.trail?.length > 1 && (
                  <Polyline positions={selected.trail.map((p) => [p.lat, p.lng])}
                    pathOptions={{ color: '#dc2626', weight: 3, dashArray: '4 4' }} />
                )}
              </MapContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                Waiting for the first location update…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
