import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polygon, Circle } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../api'
import { useAuth } from '../../auth.jsx'
import { ScoreGauge, Card } from '../../components/ui.jsx'
import { touristIcon, policeIcon, riskColor } from '../../components/mapIcons'
import { haversineKm, pointInPoly } from '../../components/geo'
import { TRACK_INTERVAL_MS, SIMULATE_GPS } from '../../config'
import useSpeechRecognition from '../../hooks/useSpeechRecognition'
import useGeolocation from '../../hooks/useGeolocation'
import useWebSocket from '../../useWebSocket'
import LanguageSwitcher from '../../components/LanguageSwitcher.jsx'
import ThemeToggle from '../../components/ThemeToggle.jsx'
import ScoreExplanation from '../../components/ScoreExplanation.jsx'
import TrajectoryOverlay from '../../components/TrajectoryOverlay.jsx'
import RiskForecastStrip from '../../components/RiskForecastStrip.jsx'
import { enqueueSOS, flushQueue, queueLength } from '../../lib/offlineQueue'
import useOnlineStatus from '../../hooks/useOnlineStatus'

export default function TouristApp() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const { t, i18n } = useTranslation()
  const tid = user.tourist_id
  const online = useOnlineStatus()
  const [me, setMe] = useState(null)
  const [score, setScore] = useState(null)
  const [zones, setZones] = useState([])
  const [units, setUnits] = useState([])
  const [trajectory, setTrajectory] = useState([])
  const [riskForecast, setRiskForecast] = useState([])
  const [tracking, setTracking] = useState(true)
  const [toast, setToast] = useState(null)
  const [sosSent, setSosSent] = useState(null)
  const [sosQueued, setSosQueued] = useState(false)
  const [pendingCount, setPendingCount] = useState(queueLength())
  const [emergencyMessage, setEmergencyMessage] = useState('')
  const posRef = useRef(null)
  const speech = useSpeechRecognition({ lang: i18n.resolvedLanguage || i18n.language })
  const geo = useGeolocation({ enabled: tracking && !SIMULATE_GPS })
  const lastSentGeoTs = useRef(0)

  const load = async () => {
    const [m, s, z, u] = await Promise.all([
      api.get(`/tourists/${tid}`),
      api.get(`/tourists/${tid}/safety-score`),
      api.get('/zones'),
      api.get('/police-units'),
    ])
    setMe(m.data); setScore(s.data); setZones(z.data); setUnits(u.data)
    setTracking(m.data.tracking_enabled)
    posRef.current = [m.data.last_lat, m.data.last_lng]
  }
  useEffect(() => { load() }, [])

  // Trajectory + dynamic risk forecast for this tourist's own map/score card.
  // Best-effort refresh alongside the location poll -- neither failing
  // should block the rest of the app view.
  useEffect(() => {
    if (!tid) return
    const loadForecasts = () => {
      api.get(`/tourists/${tid}/trajectory-forecast`).then((r) => setTrajectory(r.data.points)).catch(() => {})
      api.get(`/tourists/${tid}/risk-forecast`).then((r) => setRiskForecast(r.data.forecast)).catch(() => {})
    }
    loadForecasts()
    const iv = setInterval(loadForecasts, TRACK_INTERVAL_MS)
    return () => clearInterval(iv)
  }, [tid])

  const pushLocation = async (lat, lng, speedKmh) => {
    posRef.current = [lat, lng]
    const { data } = await api.post(`/tourists/${tid}/location`, { lat, lng, speed_kmh: speedKmh })
    setScore((s) => ({ ...s, score: data.safety_score, band: data.band }))
    setMe((m) => ({ ...m, last_lat: lat, last_lng: lng, safety_score: data.safety_score }))
    if (data.alerts_raised?.length) {
      setToast(`⚠ ${data.alerts_raised.join(', ').replace(/_/g, ' ')}`)
      setTimeout(() => setToast(null), 4000)
    }
  }

  // Opt-in live tracking. Two sources, chosen by VITE_SIMULATE_GPS:
  //  - simulated: a random walk on a timer, for demos on a machine with no
  //    meaningful GPS (the default, matching the project's existing demo mode)
  //  - real: navigator.geolocation via useGeolocation, pushed whenever the
  //    device reports a new fix (throttled to TRACK_INTERVAL_MS)
  useEffect(() => {
    if (!tracking || !me || !SIMULATE_GPS) return
    const iv = setInterval(() => {
      const [lat, lng] = posRef.current
      const nlat = lat + (Math.random() - 0.5) * 0.002
      const nlng = lng + (Math.random() - 0.5) * 0.002
      pushLocation(nlat, nlng, 5)
    }, TRACK_INTERVAL_MS)
    return () => clearInterval(iv)
  }, [tracking, me?.id])

  useEffect(() => {
    if (!tracking || !me || SIMULATE_GPS || !geo.position) return
    const now = Date.now()
    if (now - lastSentGeoTs.current < TRACK_INTERVAL_MS) return
    lastSentGeoTs.current = now
    pushLocation(geo.position.lat, geo.position.lng, geo.position.speedKmh)
  }, [geo.position, tracking, me?.id])

  const toggleTracking = async () => {
    const next = !tracking
    setTracking(next)
    await api.post(`/tourists/${tid}/tracking?enabled=${next}`)
  }

  const postSOS = (payload) => api.post(`/tourists/${tid}/sos`, payload)

  const sendSOS = async () => {
    const [lat, lng] = posRef.current
    const message = emergencyMessage.trim() || 'Emergency! Need help.'
    const payload = { lat, lng, message }
    try {
      const { data } = await postSOS(payload)
      setSosSent(data)
      setSosQueued(false)
    } catch (err) {
      // No response at all (offline, DNS failure, connection refused) means
      // the request never reached the server -- queue it rather than lose
      // the tap. A real server error (4xx/5xx) DID reach the server, so
      // that's a genuine failure to surface, not something to silently retry.
      if (!err.response) {
        enqueueSOS(payload)
        setPendingCount(queueLength())
        setSosQueued(true)
      } else {
        throw err
      }
    }
    setEmergencyMessage('')
    speech.reset()
    load()
  }

  // Flush any queued SOS the moment connectivity returns, and once on mount
  // in case one was queued in a previous session that never got a chance to
  // retry (the tab was closed, the app was killed, etc).
  useEffect(() => {
    const tryFlush = async () => {
      const sent = await flushQueue((payload) => postSOS(payload))
      if (sent > 0) {
        setPendingCount(queueLength())
        setToast(`✅ ${sent} queued SOS alert${sent > 1 ? 's' : ''} sent`)
        setTimeout(() => setToast(null), 5000)
      }
    }
    tryFlush()
    window.addEventListener('online', tryFlush)
    return () => window.removeEventListener('online', tryFlush)
  }, [tid])

  // Voice input fills the description box as soon as a transcript arrives —
  // the tourist can review or edit it before the SOS button is pressed.
  useEffect(() => {
    if (speech.transcript) setEmergencyMessage(speech.transcript)
  }, [speech.transcript])

  // Live push of this tourist's own alerts (geofence/anomaly/health/fall),
  // server-side scoped to their own record. Previously the app only learned
  // about an alert the next time ITS OWN ping happened to raise one --
  // now a server-detected event (e.g. from a linked IoT band) shows up
  // immediately instead of waiting for the next poll.
  useWebSocket((ev) => {
    if (ev.event === 'alert') {
      setToast(`⚠ ${ev.type?.replace(/_/g, ' ')}: ${ev.message}`)
      setTimeout(() => setToast(null), 5000)
    }
  }, tid ? `/ws/tourist/${tid}` : null)

  if (!me || !score) return <div className="p-6 text-center text-slate-500 dark:text-slate-400">{t('app.loading')}</div>

  const inZones = zones.filter((z) => pointInPoly(me.last_lat, me.last_lng, z.polygon))
  const riskyZone = inZones.find((z) => ['high', 'restricted'].includes(z.risk_level))
  const nearby = [...units]
    .map((u) => ({ ...u, dist: haversineKm(me.last_lat, me.last_lng, u.lat, u.lng) }))
    .sort((a, b) => a.dist - b.dist).slice(0, 3)

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 pb-24">
      <header className="bg-sky-600 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-[1000]">
        <div>
          <div className="text-xs opacity-80">{t('app.digital_id')}</div>
          <div className="font-bold">{me.digital_id}</div>
        </div>
        <div className="flex items-center gap-2">
          {!online && (
            <span className="text-xs bg-orange-500/90 px-2 py-1 rounded-full font-semibold">
              📡 Offline
            </span>
          )}
          <LanguageSwitcher />
          <ThemeToggle />
          <button onClick={() => { logout(); nav('/login') }} className="text-sm bg-sky-700 px-3 py-1 rounded-lg">
            {t('app.logout')}
          </button>
        </div>
      </header>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 bg-orange-500 text-white px-4 py-2 rounded-lg shadow-lg z-[1001] text-sm">
          {toast}
        </div>
      )}

      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* safety score */}
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

        {/* dynamic risk forecast: predicted score at +15/+30/+60 min */}
        <RiskForecastStrip forecast={riskForecast} />

        {/* geofence warning */}
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

        {/* map */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm overflow-hidden" style={{ height: 240 }}>
          <MapContainer center={[me.last_lat, me.last_lng]} zoom={14} style={{ height: '100%' }} key={me.id}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
            {zones.map((z) => (
              <Polygon key={z.id} positions={z.polygon}
                pathOptions={{ color: riskColor[z.risk_level], fillOpacity: 0.15, weight: 1.5 }} />
            ))}
            <Marker position={[me.last_lat, me.last_lng]} icon={touristIcon(score.score)} />
            {nearby.map((u) => <Marker key={u.id} position={[u.lat, u.lng]} icon={policeIcon} />)}
            <TrajectoryOverlay points={trajectory} />
          </MapContainer>
        </div>

        {/* live tracking toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-slate-100">{t('tracking.title')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('tracking.subtitle')}</div>
            </div>
            <button onClick={toggleTracking}
              className={`w-14 h-8 rounded-full transition relative ${tracking ? 'bg-green-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${tracking ? 'left-7' : 'left-1'}`}></span>
            </button>
          </div>
          {!SIMULATE_GPS && tracking && geo.permissionState === 'denied' && (
            <div className="mt-2 text-xs text-red-600">
              Location permission denied — enable it in your browser settings to be tracked.
            </div>
          )}
          {!SIMULATE_GPS && tracking && geo.permissionState === 'unsupported' && (
            <div className="mt-2 text-xs text-orange-600">
              This device doesn't support location services.
            </div>
          )}
        </div>

        {/* itinerary tracker */}
        <Card title={t('itinerary.title')}>
          <ol className="space-y-2">
            {me.itinerary?.map((w, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className={`w-2.5 h-2.5 rounded-full ${i === 0 ? 'bg-sky-500' : 'bg-slate-300'}`}></span>
                <span className={i === 0 ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}>{w.name}</span>
                {i === 0 && <span className="text-xs text-sky-600 ml-auto">{t('itinerary.next_stop')}</span>}
              </li>
            ))}
          </ol>
        </Card>

        {/* nearby police */}
        <Card title={t('police.title')}>
          <ul className="space-y-2">
            {nearby.map((u) => (
              <li key={u.id} className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{u.station} · ☎ {u.phone}</div>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">{u.dist.toFixed(1)} km</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* voice/text emergency description — optional context sent with SOS */}
        <Card title={t('sos.describe_title')}>
          <textarea
            value={emergencyMessage}
            onChange={(e) => setEmergencyMessage(e.target.value)}
            placeholder={t('sos.describe_placeholder')}
            rows={3}
            className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            {speech.supported ? (
              <button
                onClick={speech.listening ? speech.stop : speech.start}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
                  speech.listening ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                {speech.listening ? t('sos.listening') : t('sos.speak')}
              </button>
            ) : (
              <span className="text-xs text-slate-400">{t('sos.voice_unsupported')}</span>
            )}
            {speech.error && <span className="text-xs text-red-500">{speech.error}</span>}
          </div>
          <div className="text-xs text-slate-400 mt-2">{t('sos.describe_note')}</div>
        </Card>

        {sosSent && (
          <div className="bg-red-600 text-white rounded-xl p-4 text-sm">
            <div className="font-bold">🚨 {t('sos.sent_title')}</div>
            {sosSent.nearest_unit && (
              <div className="mt-1">
                {t('sos.dispatched', {
                  name: sosSent.nearest_unit.name,
                  station: sosSent.nearest_unit.station,
                  km: sosSent.nearest_unit.distance_km,
                })}
              </div>
            )}
            <div className="mt-1 text-red-100 text-xs">
              {t('sos.contacts_notified', {
                list: sosSent.notified_contacts?.map((c) => c.name).join(', '),
              })}
            </div>
          </div>
        )}

        {sosQueued && (
          <div className="bg-orange-500 text-white rounded-xl p-4 text-sm">
            <div className="font-bold">📡 SOS queued — no connection</div>
            <div className="mt-1 text-orange-50">
              You're offline. Your SOS was saved on this device and will be sent
              automatically the moment you're back online.
            </div>
          </div>
        )}

        {pendingCount > 0 && !sosQueued && (
          <div className="text-xs text-center text-orange-600 dark:text-orange-400">
            {pendingCount} SOS alert{pendingCount > 1 ? 's' : ''} still queued, waiting for a connection…
          </div>
        )}
      </div>

      {/* SOS button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-100 dark:from-slate-900 to-transparent">
        <div className="max-w-md mx-auto">
          <button onClick={sendSOS}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-4 rounded-2xl shadow-lg sos-pulse">
            🆘 {t('sos.button')}
          </button>
        </div>
      </div>
    </div>
  )
}
