import { useEffect, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import api from '../../api'
import { Card, Stat } from '../../components/ui.jsx'
import { downloadCSV } from '../../lib/csv'

// Validated categorical order (dataviz reference palette) — assigned by fixed order, never cycled.
const CATEGORICAL = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948']
// Reserved status palette — severity is a state, not a series.
const STATUS = { low: '#0ca30c', medium: '#fab219', high: '#ec835a', critical: '#d03b3b' }
// Sequential blue ramp for magnitude (crime index).
const SEQ = ['#cde2fb', '#9ec5f4', '#5598e7', '#2a78d6', '#184f95']

const INK = { grid: '#e1e0d9', axis: '#898781', text: '#52514e' }

function seqColor(v, max) {
  const i = Math.min(SEQ.length - 1, Math.floor((v / (max || 1)) * SEQ.length))
  return SEQ[i]
}

function ExportButton({ filename, rows }) {
  return (
    <button onClick={() => downloadCSV(filename, rows)} disabled={!rows?.length}
      className="text-xs text-sky-600 hover:text-sky-700 font-semibold disabled:opacity-30 disabled:cursor-not-allowed">
      ⭳ CSV
    </button>
  )
}

// One-click printable report -- the visual counterpart to the per-chart CSV
// exports above. GET /analytics/pdf renders the same aggregates server-side.
function PdfExportButton() {
  const [loading, setLoading] = useState(false)
  const download = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/analytics/pdf', { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } finally {
      setLoading(false)
    }
  }
  return (
    <button onClick={download} disabled={loading}
      className="text-sm text-sky-600 hover:text-sky-700 font-semibold disabled:opacity-50">
      {loading ? 'Generating…' : '⭳ Download PDF Report'}
    </button>
  )
}

export default function Analytics() {
  const [summary, setSummary] = useState(null)
  const [overTime, setOverTime] = useState([])
  const [byType, setByType] = useState([])
  const [zoneRisk, setZoneRisk] = useState([])
  const [severity, setSeverity] = useState([])

  useEffect(() => {
    Promise.all([
      api.get('/analytics/summary'),
      api.get('/analytics/incidents-over-time'),
      api.get('/analytics/alerts-by-type'),
      api.get('/analytics/zone-risk'),
      api.get('/analytics/severity-breakdown'),
    ]).then(([s, o, t, z, sev]) => {
      setSummary(s.data); setOverTime(o.data); setByType(t.data)
      setZoneRisk(z.data); setSeverity(sev.data)
    })
  }, [])

  const maxCrime = Math.max(1, ...zoneRisk.map((z) => z.crime_index))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-800">Analytics &amp; Reporting</h2>
        <PdfExportButton />
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total Incidents" value={summary.total_incidents} />
          <Stat label="Avg Response Time" value={`${Math.round(summary.avg_response_time_seconds)}s`} />
          <Stat label="Active Alerts" value={summary.active_alerts} accent="text-orange-600" />
          <Stat label="Risk Zones" value={summary.total_zones} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Incidents Over Time" actions={<ExportButton filename="incidents-over-time" rows={overTime} />}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={overTime} margin={{ top: 10, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: INK.axis, fontSize: 12 }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: INK.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" name="Incidents" stroke={CATEGORICAL[0]}
                strokeWidth={2} dot={{ r: 3, fill: CATEGORICAL[0] }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Alerts by Type" actions={<ExportButton filename="alerts-by-type" rows={byType} />}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byType} margin={{ top: 16, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis dataKey="type" tick={{ fill: INK.axis, fontSize: 11 }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: INK.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {byType.map((_, i) => <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />)}
                <LabelList dataKey="count" position="top" fill={INK.text} fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Zone-wise Crime Index (higher = riskier)" actions={<ExportButton filename="zone-risk" rows={zoneRisk} />}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={zoneRisk} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={INK.grid} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: INK.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="zone" width={150} tick={{ fill: INK.text, fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="crime_index" radius={[0, 4, 4, 0]}>
                {zoneRisk.map((z, i) => <Cell key={i} fill={seqColor(z.crime_index, maxCrime)} />)}
                <LabelList dataKey="crime_index" position="right" fill={INK.text} fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Incident Severity Breakdown" actions={<ExportButton filename="severity-breakdown" rows={severity} />}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={severity} margin={{ top: 16, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis dataKey="severity" tick={{ fill: INK.axis, fontSize: 12 }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: INK.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {severity.map((s, i) => <Cell key={i} fill={STATUS[s.severity] || '#898781'} />)}
                <LabelList dataKey="count" position="top" fill={INK.text} fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-3 mt-2 text-xs text-slate-500 flex-wrap">
            {Object.entries(STATUS).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: v }}></span>{k}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
