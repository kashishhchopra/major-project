import { useEffect, useState } from 'react'
import api from '../../api'
import { Card } from '../../components/ui.jsx'

export default function AuditLog() {
  const [rows, setRows] = useState([])

  useEffect(() => {
    const load = () => api.get('/audit-log?limit=200').then((r) => setRows(r.data))
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-800">Security Audit Log</h2>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Target</th>
                <th className="py-2 pr-4">IP</th>
                <th className="py-2 pr-4">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan="6" className="py-4 text-slate-400">No audit entries yet.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{new Date(r.timestamp).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-medium capitalize">{r.action.replace('_', ' ')}</td>
                  <td className="py-2 pr-4">{r.actor}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.target || '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.ip || '—'}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.outcome === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {r.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
