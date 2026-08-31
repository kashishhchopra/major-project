import { useEffect, useState } from 'react'
import api from '../api'

const HAZARD_ICON = { flood: '🌊', landslide: '⛰️', earthquake: '🌍', storm: '⛈️' }
const SEVERITY_CLS = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-white',
  low: 'bg-slate-400 text-white',
}

// Disaster & Weather Alert Feeds: any active hazard advisory for the zone
// the tourist is currently in. Polls GET /tourists/{id}/disasters -- see
// services/disaster.py.
export default function DisasterBanner({ touristId }) {
  const [advisories, setAdvisories] = useState([])

  useEffect(() => {
    const load = () => api.get(`/tourists/${touristId}/disasters`).then((r) => setAdvisories(r.data)).catch(() => {})
    load()
    const iv = setInterval(load, 60000)
    return () => clearInterval(iv)
  }, [touristId])

  if (advisories.length === 0) return null

  return (
    <div className="space-y-2">
      {advisories.map((a) => (
        <div key={a.id} className={`rounded-xl p-3 text-sm font-medium flex items-start gap-2 ${SEVERITY_CLS[a.severity] || SEVERITY_CLS.medium}`}>
          <span className="text-lg leading-none">{HAZARD_ICON[a.hazard_type] || '⚠️'}</span>
          <div>
            <div className="font-bold uppercase text-xs tracking-wide">{a.hazard_type} advisory</div>
            <div>{a.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
