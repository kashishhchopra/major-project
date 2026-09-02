import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polygon, Polyline, Popup, useMap } from 'react-leaflet'
import api from '../../api'
import { Card, Stat } from '../../components/ui.jsx'
import { touristIcon, sosIcon, stationIcon, cameraIcon, centralIcon, riskColor } from '../../components/mapIcons'
import { DEFAULT_MAP, loadMapConfig } from '../../config'

// ---------------------------------------------------------------- demo data
// The backend tracks named units (PoliceUnit) and real zone/camera/tourist
// counts, but not a station's full roster -- "officers" and "active units"
// here are a stable, per-station operational estimate for the demo, not a
// live headcount. Everything else on this page (stations, zones, incidents,
// cameras, tourists, forwarding) is real data from the API.
const DEMO_META = {
  'City Central PS': { officers: 32, activeUnits: 12 },
  'Riverside PS': { officers: 22, activeUnits: 9 },
  'Market PS': { officers: 28, activeUnits: 14 },
  'Hillside Outpost': { officers: 14, activeUnits: 6 },
}

function demoMetaFor(station) {
  if (DEMO_META[station.name]) return DEMO_META[station.name]
  const seed = (station.id * 2654435761) % 97
  return { officers: 14 + (seed % 20), activeUnits: 5 + (seed % 10) }
}

function polygonCentroid(polygon) {
  if (!polygon || polygon.length === 0) return null
  const lat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
  const lng = polygon.reduce((s, p) => s + p[1], 0) / polygon.length
  return [lat, lng]
}

// Station operational status derives from its real open/critical incident
// count (from /police-network/dashboard) -- red only ever means an actual
// emergency, per the control-room colour convention used across the app.
function stationStatus(entry, simCritical) {
  if (simCritical) return 'critical'
  if (entry.critical_incidents > 0) return 'critical'
  if (entry.open_incidents > 0) return 'caution'
  return 'online'
}

const STATUS_META = {
  online: { dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400', label: 'ONLINE' },
  caution: { dot: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', label: 'RESPONDING' },
  critical: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'EMERGENCY' },
}

function StatusDot({ status }) {
  const m = STATUS_META[status] || STATUS_META.online
  return <span className={`inline-block w-2 h-2 rounded-full ${m.dot} ${status === 'critical' ? 'sos-pulse' : ''}`} />
}

// Recentres the shared map imperatively when a zone/station is selected
// elsewhere on the page -- must live inside <MapContainer/> to reach useMap().
function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.8 })
  }, [target, map])
  return null
}

const FLOW_STEPS = ['Location', 'Zone', 'Station', 'Central', 'Network', 'Response']

function FlowBreadcrumb() {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap py-1">
      {FLOW_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1.5">
          <span className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300">
            {step}
          </span>
          {i < FLOW_STEPS.length - 1 && <span className="text-slate-400 dark:text-slate-600">→</span>}
        </div>
      ))}
    </div>
  )
}

const SIM_STAGES = [
  'Tourist SOS raised',
  'Zone identified',
  'Station notified',
  'Central Dashboard updated',
  'Nearest unit dispatched',
]

export default function PoliceNetwork() {
  const [dashboard, setDashboard] = useState(null)
  const [stations, setStations] = useState([])
  const [zones, setZones] = useState([])
  const [density, setDensity] = useState([])
  const [units, setUnits] = useState([])
  const [tourists, setTourists] = useState([])
  const [cameras, setCameras] = useState([])
  const [mapCfg, setMapCfg] = useState(DEFAULT_MAP)
  const [error, setError] = useState(null)

  const [focusTarget, setFocusTarget] = useState(null)
  const [highlightStationId, setHighlightStationId] = useState(null)
  const [detailStation, setDetailStation] = useState(null)
  const [contactStation, setContactStation] = useState(null)
  const [contactConnected, setContactConnected] = useState(false)
  const [activeCamera, setActiveCamera] = useState(null)
  const [forwardTarget, setForwardTarget] = useState({})

  const [activity, setActivity] = useState(() => {
    const now = Date.now()
    return [
      { id: 'seed-1', time: new Date(now - 2 * 60000), from: 'Riverside PS', to: 'Central', text: 'Patrol unit status updated' },
      { id: 'seed-2', time: new Date(now - 4 * 60000), from: 'Central', to: 'Market PS', text: 'CCTV feed requested' },
      { id: 'seed-3', time: new Date(now - 6 * 60000), from: 'Hillside Outpost', to: 'Central', text: 'Incident case updated' },
      { id: 'seed-4', time: new Date(now - 8 * 60000), from: 'Central', to: 'Riverside PS', text: 'Tourist location shared' },
    ]
  })
  const [sim, setSim] = useState(null) // { touristId, stationId, stationName, zoneName, lat, lng, stage }
  const simTimers = useRef([])

  const pushActivity = (from, to, text) => {
    setActivity((prev) => [{ id: `${Date.now()}-${Math.random()}`, time: new Date(), from, to, text }, ...prev].slice(0, 40))
  }

  const load = () => {
    Promise.all([
      api.get('/police-network/dashboard'),
      api.get('/police-network/stations'),
      api.get('/zones'),
      api.get('/zones/crowd-density'),
      api.get('/police-units'),
      api.get('/tourists'),
    ])
      .then(([d, s, z, dens, u, t]) => {
        setDashboard(d.data)
        setStations(s.data)
        setZones(z.data)
        setDensity(dens.data)
        setUnits(u.data)
        setTourists(t.data)
        setError(null)
      })
      .catch(() => setError('Failed to load the police network dashboard.'))
  }

  useEffect(() => {
    load()
    loadMapConfig((p) => api.get(p)).then(setMapCfg)
    const iv = setInterval(load, 15000)
    return () => { clearInterval(iv); simTimers.current.forEach(clearTimeout) }
  }, [])

  // Real CCTV coverage near each station, merged/deduped -- the "Nearby
  // CCTV" section and each station's camera count both come from here.
  useEffect(() => {
    if (stations.length === 0) return
    Promise.all(
      stations.map((s) =>
        api.get(`/police-network/cameras/nearby?lat=${s.lat}&lng=${s.lng}&radius_m=3000`)
          .then((r) => r.data).catch(() => [])
      )
    ).then((lists) => {
      const byId = new Map()
      lists.flat().forEach((c) => byId.set(c.id, c))
      setCameras([...byId.values()])
    })
  }, [stations])

  const zoneById = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z])), [zones])
  const densityByZone = useMemo(() => Object.fromEntries(density.map((d) => [d.zone_id, d])), [density])
  const dashByStation = useMemo(
    () => Object.fromEntries((dashboard?.stations || []).map((s) => [s.id, s])), [dashboard]
  )

  const central = useMemo(() => {
    if (stations.length === 0) return null
    const lat = stations.reduce((s, p) => s + p.lat, 0) / stations.length
    const lng = stations.reduce((s, p) => s + p.lng, 0) / stations.length
    return [lat, lng]
  }, [stations])

  // Per-station derived stats: real open/critical cases, cameras and
  // tourists from the API, plus the demo officer/unit roster estimate.
  const statsFor = (station) => {
    const entry = dashByStation[station.id] || { open_incidents: 0, critical_incidents: 0, incident_ids: [], zone_name: null }
    const zone = station.zone_id ? zoneById[station.zone_id] : null
    const simHere = sim && sim.stationId === station.id
    const openCases = entry.open_incidents + (simHere ? 1 : 0)
    const status = stationStatus(entry, simHere)
    const meta = demoMetaFor(station)
    const cameraCount = cameras.filter((c) => c.zone_id === station.zone_id).length
    const touristCount = station.zone_id ? (densityByZone[station.zone_id]?.tourist_count ?? 0) : 0
    const stationUnits = units.filter((u) => u.station === station.name)
    return { entry, zone, status, openCases, meta, cameraCount, touristCount, stationUnits }
  }

  const onlineCount = stations.filter((s) => statsFor(s).status !== 'critical').length
  const totalActiveUnits = stations.reduce((sum, s) => sum + statsFor(s).meta.activeUnits, 0)
  const totalOpenCases = (dashboard?.total_open_incidents || 0) + (sim ? 1 : 0)

  const focusOnStation = (station) => {
    setHighlightStationId(station.id)
    setFocusTarget([station.lat, station.lng])
  }

  const forwardIncident = async (incidentId, fromStationId) => {
    const toStationId = Number(forwardTarget[incidentId])
    if (!toStationId || toStationId === fromStationId) return
    const toStation = stations.find((s) => s.id === toStationId)
    const fromStation = stations.find((s) => s.id === fromStationId)
    try {
      await api.post(`/police-network/incidents/${incidentId}/forward`, {
        to_station_id: toStationId, note: 'Forwarded from Central Safety Dashboard',
      })
      pushActivity(fromStation?.name || 'Station', toStation?.name || 'Station',
        `Case #${incidentId} forwarded`)
      load()
    } catch {
      setError('Failed to forward the incident.')
    }
  }

  const openContact = (station) => {
    setContactStation(station)
    setContactConnected(false)
    pushActivity('Central', station.name, 'Contact request sent')
    setTimeout(() => setContactConnected(true), 900)
  }

  // Client-side demo only -- does not touch real tourist/incident data.
  // Walks a fake SOS through the exact routing path the backend implements
  // for real (services/police_network.py): zone -> station -> central dashboard.
  const simulateIncident = () => {
    const candidates = (dashboard?.stations || []).filter((s) => s.zone_id)
    if (candidates.length === 0) return
    simTimers.current.forEach(clearTimeout)
    simTimers.current = []

    const target = candidates[Math.floor(Math.random() * candidates.length)]
    const zone = zoneById[target.zone_id]
    const centroid = polygonCentroid(zone?.polygon) || [target.lat, target.lng]
    const touristId = `T-${1000 + Math.floor(Math.random() * 900)}`

    setSim({
      touristId, stationId: target.id, stationName: target.name,
      zoneName: target.zone_name, lat: centroid[0], lng: centroid[1], stage: 0,
    })
    pushActivity(`Tourist ${touristId}`, 'Central', 'SOS button pressed')
    setFocusTarget(centroid)

    const steps = [
      { at: 900, run: () => pushActivity('Central', 'System', `Zone resolved: ${zone?.name || target.zone_name}`) },
      { at: 1800, run: () => pushActivity('Central', target.name, `SOS forwarded — tourist ${touristId}`) },
      { at: 2700, run: () => pushActivity(target.name, 'Central', 'Case acknowledged') },
      { at: 3600, run: () => pushActivity(target.name, 'Central', 'Nearest unit dispatched — ETA ~6 min') },
    ]
    steps.forEach((step, i) => {
      simTimers.current.push(setTimeout(() => {
        step.run()
        setSim((prev) => (prev && prev.touristId === touristId ? { ...prev, stage: i + 1 } : prev))
      }, step.at))
    })
  }

  const resolveSimulation = () => {
    if (!sim) return
    pushActivity(sim.stationName, 'Central', 'Incident resolved — unit returning to patrol')
    setSim(null)
  }

  if (error) return <div className="text-red-600 text-sm">{error}</div>
  if (!dashboard) return <div className="text-slate-400 text-sm">Loading network…</div>

  return (
    <div className="space-y-4">
      {/* ---- header / network status ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Central Safety Dashboard</h2>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <StatusDot status={sim ? 'critical' : 'online'} />
              <span className="font-semibold tracking-wide">
                {sim ? 'ACTIVE RESPONSE IN PROGRESS' : 'NETWORK OPERATIONAL'}
              </span>
              <span className="text-slate-400 dark:text-slate-600">·</span>
              <span>Last synchronized {new Date(dashboard.generated_at).toLocaleTimeString()}</span>
            </div>
          </div>
          <FlowBreadcrumb />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Police Stations" value={stations.length} />
          <Stat label="Online" value={onlineCount} accent="text-green-600" />
          <Stat label="Active Units" value={totalActiveUnits} accent="text-sky-600" />
          <Stat label="Open Cases" value={totalOpenCases}
            accent={totalOpenCases > 0 ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'} />
        </div>

        {dashboard.unassigned_incidents.length > 0 && (
          <div className="text-xs bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300
                          border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-2">
            ⚠ {dashboard.unassigned_incidents.length} incident(s) fell outside every zone and are not yet
            owned by a station: {dashboard.unassigned_incidents.map((id) => `#${id}`).join(', ')}
          </div>
        )}
      </div>

      {/* ---- main map + zone table (left) / live response + activity (right) ---- */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm overflow-hidden" style={{ height: 480 }}>
            <MapContainer center={mapCfg.center} zoom={mapCfg.zoom} style={{ height: '100%', width: '100%' }}>
              <TileLayer attribution="&copy; OpenStreetMap"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FlyTo target={focusTarget} />

              {zones.map((z) => (
                <Polygon key={z.id} positions={z.polygon}
                  pathOptions={{ color: riskColor[z.risk_level], fillOpacity: 0.12, weight: 1.5 }}>
                  <Popup><b>{z.name}</b><br />Risk: {z.risk_level}</Popup>
                </Polygon>
              ))}

              {/* hub-and-spoke: every station <-> the Central Safety Dashboard */}
              {central && stations.map((s) => (
                <Polyline key={`hub${s.id}`} positions={[central, [s.lat, s.lng]]}
                  pathOptions={{ color: '#0ea5e9', weight: 2, opacity: 0.6, dashArray: '6 8', className: 'network-line' }} />
              ))}
              {/* peer mesh ring: stations directly interconnected, not just via the hub */}
              {stations.map((s, i) => {
                const next = stations[(i + 1) % stations.length]
                if (!next || stations.length < 2) return null
                return (
                  <Polyline key={`ring${s.id}`} positions={[[s.lat, s.lng], [next.lat, next.lng]]}
                    pathOptions={{ color: '#64748b', weight: 1, opacity: 0.4, dashArray: '2 6' }} />
                )
              })}
              {/* live simulated SOS -> station link */}
              {sim && (
                <Polyline positions={[[sim.lat, sim.lng], (() => {
                  const st = stations.find((s) => s.id === sim.stationId)
                  return st ? [st.lat, st.lng] : [sim.lat, sim.lng]
                })()]} pathOptions={{ color: '#dc2626', weight: 3, opacity: 0.85 }} />
              )}

              {central && (
                <Marker position={central} icon={centralIcon}>
                  <Popup><b>Central Safety Dashboard</b><br />Interconnected police network hub</Popup>
                </Marker>
              )}
              {stations.map((s) => {
                const { status, entry } = statsFor(s)
                return (
                  <Marker key={s.id} position={[s.lat, s.lng]} icon={stationIcon(status)}
                    eventHandlers={{ click: () => focusOnStation(s) }}>
                    <Popup>
                      <b>{s.name}</b><br />
                      Covers: {entry.zone_name || 'unassigned'}<br />
                      {entry.open_incidents} open case(s)
                    </Popup>
                  </Marker>
                )
              })}
              {cameras.map((c) => (
                <Marker key={`cam${c.id}`} position={[c.lat, c.lng]} icon={cameraIcon}>
                  <Popup><b>{c.label}</b><br />{c.status}</Popup>
                </Marker>
              ))}
              {tourists.filter((t) => t.last_lat).map((t) => (
                <Marker key={`t${t.id}`} position={[t.last_lat, t.last_lng]} icon={touristIcon(t.safety_score)}>
                  <Popup><b>{t.full_name}</b><br />{t.status}</Popup>
                </Marker>
              ))}
              {sim && <Marker position={[sim.lat, sim.lng]} icon={sosIcon}>
                <Popup><b>{sim.touristId}</b> — simulated SOS</Popup>
              </Marker>}
            </MapContainer>
          </div>

          <Card title="Zone Coverage & Assignment">
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700">
                    <th className="pb-2 pr-2">Zone</th>
                    <th className="pb-2 pr-2">Risk</th>
                    <th className="pb-2 pr-2">Station</th>
                    <th className="pb-2 pr-2 text-right">Tourists</th>
                    <th className="pb-2 pr-2 text-right">Cameras</th>
                    <th className="pb-2 text-right">Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {stations.map((s) => {
                    const st = statsFor(s)
                    return (
                      <tr key={s.id}
                        onClick={() => focusOnStation(s)}
                        className={`cursor-pointer border-b border-slate-50 dark:border-slate-700/50 last:border-0
                          hover:bg-slate-50 dark:hover:bg-slate-700/40 ${highlightStationId === s.id ? 'bg-sky-50 dark:bg-sky-900/20' : ''}`}>
                        <td className="py-2 pr-2 font-medium">{st.zone?.name || '—'}</td>
                        <td className="py-2 pr-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: riskColor[st.zone?.risk_level] || '#94a3b8' }} />
                            <span className="capitalize text-xs text-slate-500 dark:text-slate-400">{st.zone?.risk_level || '—'}</span>
                          </span>
                        </td>
                        <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">{s.name}</td>
                        <td className="py-2 pr-2 text-right">{st.touristCount}</td>
                        <td className="py-2 pr-2 text-right">{st.cameraCount}</td>
                        <td className={`py-2 text-right font-semibold ${st.openCases > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {st.openCases}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* live response */}
          <Card title="Live Response">
            {sim ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400">Tourist</div>
                    <div className="font-semibold">{sim.touristId}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Assigned Station</div>
                    <div className="font-semibold">{sim.stationName}</div>
                  </div>
                </div>
                <div className="text-xs text-slate-400">Zone: <span className="text-slate-600 dark:text-slate-300">{sim.zoneName}</span></div>
                <div className="space-y-1 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                  {SIM_STAGES.map((label, i) => (
                    <div key={label} className={`text-xs flex items-center gap-1.5 ${i <= sim.stage ? 'text-slate-700 dark:text-slate-200 font-medium' : 'text-slate-300 dark:text-slate-600'}`}>
                      <span>{i <= sim.stage ? '✔' : '○'}</span>{label}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 flex items-center gap-1.5">
                    <StatusDot status="caution" /> RESPONSE IN PROGRESS
                  </span>
                  {sim.stage >= SIM_STAGES.length - 1 && (
                    <button onClick={resolveSimulation}
                      className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1 rounded-lg">
                      Mark Resolved
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-center py-2">
                <div className="text-green-600 dark:text-green-400 font-semibold flex items-center justify-center gap-1.5">
                  <StatusDot status="online" /> No active emergency responses
                </div>
                <button onClick={simulateIncident}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                  🚨 Simulate Incident
                </button>
              </div>
            )}
          </Card>

          {/* network activity feed */}
          <Card title="Police Network Activity">
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto">
              {activity.map((a) => (
                <div key={a.id} className="text-xs border-b border-slate-50 dark:border-slate-700/50 pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>{a.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="font-medium text-slate-700 dark:text-slate-200">
                    {a.from} <span className="text-slate-400">→</span> {a.to}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">{a.text}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ---- station cards ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stations.map((s) => {
          const st = statsFor(s)
          const meta = STATUS_META[st.status]
          return (
            <div key={s.id}
              className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border transition
                ${highlightStationId === s.id ? 'border-sky-400 ring-1 ring-sky-300' : 'border-transparent'}`}>
              <div onClick={() => focusOnStation(s)}
                className="cursor-pointer px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-wide">{s.name}</div>
                </div>
                <div className={`text-[11px] font-semibold flex items-center gap-1.5 mt-0.5 ${meta.text}`}>
                  <StatusDot status={st.status} /> {meta.label}
                </div>
              </div>
              <div className="p-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                <div>📍 {st.zone?.name || 'No zone assigned'}</div>
                <div>👮 {s.contact_officer || '—'}</div>
                <div className="grid grid-cols-2 gap-y-1.5 pt-1 text-slate-700 dark:text-slate-200">
                  <div>🚓 {st.meta.activeUnits} Active Units</div>
                  <div>📹 {st.cameraCount} Cameras</div>
                  <div>👥 {st.touristCount} Tourists</div>
                  <div className={st.openCases > 0 ? 'text-red-600 font-semibold' : ''}>🚨 {st.openCases} Open Cases</div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setDetailStation(s)}
                    className="flex-1 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold py-1.5 rounded-lg">
                    View Station
                  </button>
                  <button onClick={() => openContact(s)}
                    className="flex-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-semibold py-1.5 rounded-lg">
                    Contact
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ---- nearby CCTV ---- */}
      <Card title="Nearby CCTV">
        {cameras.length === 0 ? (
          <div className="text-sm text-slate-400">No cameras registered yet.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {cameras.map((c) => (
              <button key={c.id} onClick={() => setActiveCamera(c)}
                className="text-left bg-slate-900 rounded-lg overflow-hidden border border-slate-700 hover:border-sky-500 transition">
                <div className="relative h-16 bg-slate-950 overflow-hidden">
                  {c.status === 'active' ? (
                    <div className="cctv-scanline absolute inset-x-0 h-6 bg-gradient-to-b from-sky-400/0 via-sky-400/20 to-sky-400/0" />
                  ) : null}
                  <span className={`absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded
                    ${c.status === 'active' ? 'bg-red-600 text-white' : 'bg-slate-600 text-slate-300'}`}>
                    {c.status === 'active' ? 'LIVE' : 'OFFLINE'}
                  </span>
                </div>
                <div className="px-2 py-1.5">
                  <div className="text-[11px] font-semibold text-slate-100 truncate">CAM-{String(c.id).padStart(3, '0')}</div>
                  <div className="text-[10px] text-slate-400 truncate">{c.label}</div>
                  <div className={`text-[10px] mt-0.5 ${c.status === 'active' ? 'text-green-400' : 'text-slate-500'}`}>
                    {c.status === 'active' ? '🟢 Online' : '⚪ Offline'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* ---- station detail modal ---- */}
      {detailStation && (() => {
        const s = detailStation
        const st = statsFor(s)
        const stationActivity = activity.filter((a) => a.from === s.name || a.to === s.name).slice(0, 6)
        const stationCameras = cameras.filter((c) => c.zone_id === s.zone_id)
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[2000] p-4"
            onClick={() => setDetailStation(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}>
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <div className="font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">{s.name}</div>
                  <div className={`text-xs font-semibold flex items-center gap-1.5 mt-0.5 ${STATUS_META[st.status].text}`}>
                    <StatusDot status={st.status} /> {STATUS_META[st.status].label}
                  </div>
                </div>
                <button onClick={() => setDetailStation(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none">✕</button>
              </div>
              <div className="p-5 space-y-4 text-sm">
                <div>
                  <div className="text-xs text-slate-400">Station Commander</div>
                  <div className="font-medium">{s.contact_officer || '—'} · ☎ {s.phone}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Coverage</div>
                  <div className="font-medium">{st.zone?.name || 'No zone assigned'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Operational Statistics</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg px-3 py-2">Officers <b className="block text-sm">{st.meta.officers}</b></div>
                    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg px-3 py-2">Active Units <b className="block text-sm">{st.meta.activeUnits}</b></div>
                    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg px-3 py-2">Cameras <b className="block text-sm">{st.cameraCount}</b></div>
                    <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg px-3 py-2">Tourists in Zone <b className="block text-sm">{st.touristCount}</b></div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-400 mb-1">Active Incidents</div>
                  {st.entry.incident_ids.length === 0 ? (
                    <div className="text-xs text-slate-400">No active cases.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {st.entry.incident_ids.map((id) => (
                        <div key={id} className="flex items-center gap-2 text-xs">
                          <span className="w-14 text-slate-500">#{id}</span>
                          <select className="flex-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded-lg px-2 py-1"
                            value={forwardTarget[id] || ''}
                            onChange={(e) => setForwardTarget({ ...forwardTarget, [id]: e.target.value })}>
                            <option value="">Forward to…</option>
                            {stations.filter((o) => o.id !== s.id).map((o) => (
                              <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                          </select>
                          <button onClick={() => forwardIncident(id, s.id)} disabled={!forwardTarget[id]}
                            className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-2 py-1 rounded-lg">
                            Send
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-slate-400 mb-1">Recent Activity</div>
                  {stationActivity.length === 0 ? (
                    <div className="text-xs text-slate-400">No recent network activity.</div>
                  ) : (
                    <div className="space-y-1">
                      {stationActivity.map((a) => (
                        <div key={a.id} className="text-xs text-slate-600 dark:text-slate-300">
                          {a.from} → {a.to}: {a.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {stationCameras.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Nearby CCTV</div>
                    <div className="flex flex-wrap gap-1.5">
                      {stationCameras.map((c) => (
                        <span key={c.id} className="text-[10px] bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full">
                          {c.status === 'active' ? '🟢' : '⚪'} {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={() => setDetailStation(null)}
                  className="w-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-semibold py-2 rounded-lg">
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ---- contact modal ---- */}
      {contactStation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[2000] p-4"
          onClick={() => setContactStation(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-xs text-center"
            onClick={(e) => e.stopPropagation()}>
            {!contactConnected ? (
              <>
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Connecting…</div>
                <div className="font-bold text-slate-800 dark:text-slate-100">{contactStation.name}</div>
              </>
            ) : (
              <>
                <div className="text-green-600 dark:text-green-400 font-semibold text-sm mb-1">🟢 Connected</div>
                <div className="font-bold text-slate-800 dark:text-slate-100">{contactStation.name}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{contactStation.contact_officer}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">☎ {contactStation.phone}</div>
              </>
            )}
            <button onClick={() => setContactStation(null)}
              className="mt-4 w-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-semibold py-2 rounded-lg">
              Close
            </button>
          </div>
        </div>
      )}

      {/* ---- camera modal ---- */}
      {activeCamera && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[2000] p-4"
          onClick={() => setActiveCamera(null)}>
          <div className="bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="relative h-52 bg-slate-950 overflow-hidden flex items-center justify-center">
              {activeCamera.status === 'active' ? (
                <>
                  <div className="cctv-scanline absolute inset-x-0 h-16 bg-gradient-to-b from-sky-400/0 via-sky-400/15 to-sky-400/0" />
                  <span className="absolute top-2 left-2 text-[10px] font-bold bg-red-600 text-white px-2 py-0.5 rounded">● DEMO LIVE</span>
                  <span className="text-slate-600 text-xs">Simulated feed — no live video source</span>
                </>
              ) : (
                <span className="text-slate-500 text-xs">📵 Camera offline</span>
              )}
            </div>
            <div className="p-4 text-sm">
              <div className="font-bold text-slate-100">CAM-{String(activeCamera.id).padStart(3, '0')}</div>
              <div className="text-slate-400">{activeCamera.label}</div>
              <button onClick={() => setActiveCamera(null)}
                className="mt-3 w-full bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm font-semibold py-2 rounded-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
