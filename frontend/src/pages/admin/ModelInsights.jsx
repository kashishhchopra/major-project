import { useEffect, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import api from '../../api'
import { Card, Stat } from '../../components/ui.jsx'

// Reuse the project's one validated palette (see Analytics.jsx) rather than
// introducing a second set of chart colors.
const CATEGORICAL = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948']
const SEQ = ['#cde2fb', '#9ec5f4', '#5598e7', '#2a78d6', '#184f95']
const INK = { grid: '#e1e0d9', axis: '#898781', text: '#52514e' }

function Metric({ label, value, suffix = '' }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-800">{value}{suffix}</div>
    </div>
  )
}

export default function ModelInsights() {
  const [report, setReport] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [registry, setRegistry] = useState(null)
  const [drift, setDrift] = useState(null)

  useEffect(() => {
    Promise.all([api.get('/ml/metrics'), api.get('/ml/status')])
      .then(([m, s]) => { setReport(m.data); setStatus(s.data) })
      .catch((e) => setError(e.response?.data?.detail || 'Failed to load model metrics.'))
    // Registry/drift are optional extras -- their absence (e.g. a fresh clone
    // that hasn't retrained since this feature landed) shouldn't block the
    // rest of the page, so failures here are swallowed rather than surfaced
    // as the page-level error.
    api.get('/ml/registry').then((r) => setRegistry(r.data)).catch(() => setRegistry(null))
    api.get('/ml/drift').then((r) => setDrift(r.data)).catch(() => setDrift(null))
  }, [])

  if (error) {
    return (
      <Card title="Model Insights">
        <div className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-3">
          {error}
        </div>
      </Card>
    )
  }
  if (!report || !status) return <div className="p-6 text-center text-slate-500">Loading…</div>

  const { anomaly, safety, zones } = report.models
  const cm = anomaly.confusion_matrix

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-800">ML Model Insights</h2>
        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
          status.inference_mode === 'model' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
          {status.inference_mode === 'model' ? '● Live models loaded' : '● Rule-based fallback (train models to activate)'}
        </span>
      </div>

      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-xs text-sky-800">
        <b>Training data:</b> {report.training_data.note}
        <span className="ml-1 text-sky-600">
          (trained {new Date(report.trained_at).toLocaleString()}, seed={report.training_data.random_seed})
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Live Pings Collected" value={status.live_pings_collected} />
        <Stat label="Anomalies Flagged" value={status.anomalies_flagged} accent="text-orange-600" />
        <Stat label="Anomaly ROC-AUC" value={anomaly.roc_auc} />
        <Stat label="Safety Score R²" value={safety.r2} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* --- Anomaly detector --- */}
        <Card title="IsolationForest — Anomaly Detection">
          <div className="grid grid-cols-4 gap-3 mb-3">
            <Metric label="Precision" value={anomaly.precision} />
            <Metric label="Recall" value={anomaly.recall} />
            <Metric label="F1" value={anomaly.f1} />
            <Metric label="ROC-AUC" value={anomaly.roc_auc} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={anomaly.roc_curve} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={INK.grid} />
              <XAxis dataKey="fpr" type="number" domain={[0, 1]}
                tick={{ fill: INK.axis, fontSize: 11 }} label={{ value: 'False Positive Rate', position: 'insideBottom', offset: -2, fontSize: 11, fill: INK.axis }} />
              <YAxis dataKey="tpr" type="number" domain={[0, 1]} tick={{ fill: INK.axis, fontSize: 11 }} />
              <Tooltip formatter={(v) => v.toFixed(3)} />
              <Line type="monotone" dataKey="tpr" stroke={CATEGORICAL[0]} strokeWidth={2} dot={false} name="ROC curve" />
            </LineChart>
          </ResponsiveContainer>
          <div className="text-xs text-slate-500 text-center mt-1">ROC curve (test set, n={anomaly.n_test})</div>
        </Card>

        <Card title="Confusion Matrix (test set)">
          <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
            {[
              ['True Negative', cm.true_negative, 'bg-green-50 text-green-800'],
              ['False Positive', cm.false_positive, 'bg-red-50 text-red-700'],
              ['False Negative', cm.false_negative, 'bg-red-50 text-red-700'],
              ['True Positive', cm.true_positive, 'bg-green-50 text-green-800'],
            ].map(([label, val, cls]) => (
              <div key={label} className={`rounded-lg p-4 text-center ${cls}`}>
                <div className="text-2xl font-bold">{val}</div>
                <div className="text-xs mt-1">{label}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-3">
            Features: {anomaly.features.join(', ')} · contamination={anomaly.contamination}
          </div>
        </Card>

        {/* --- Safety score regressor --- */}
        <Card title="RandomForest — Safety Score Fit">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Metric label="R²" value={safety.r2} />
            <Metric label="MAE" value={safety.mae} suffix=" pts" />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
              <CartesianGrid stroke={INK.grid} />
              <XAxis dataKey="actual" type="number" domain={[0, 100]} name="Actual"
                tick={{ fill: INK.axis, fontSize: 11 }} label={{ value: 'Actual score', position: 'insideBottom', offset: -2, fontSize: 11, fill: INK.axis }} />
              <YAxis dataKey="predicted" type="number" domain={[0, 100]} name="Predicted"
                tick={{ fill: INK.axis, fontSize: 11 }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke={INK.axis} strokeDasharray="4 4" />
              <Scatter data={safety.predicted_vs_actual} fill={CATEGORICAL[0]} fillOpacity={0.6} />
            </ScatterChart>
          </ResponsiveContainer>
          <div className="text-xs text-slate-500 text-center mt-1">
            Predicted vs. actual (dashed line = perfect fit)
          </div>
        </Card>

        <Card title="Feature Importance — Safety Score">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart layout="vertical" data={Object.entries(safety.feature_importances)
              .map(([feature, importance]) => ({ feature, importance }))
              .sort((a, b) => b.importance - a.importance)}
              margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={INK.grid} horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tick={{ fill: INK.axis, fontSize: 11 }} />
              <YAxis type="category" dataKey="feature" width={110} tick={{ fill: INK.text, fontSize: 11 }} />
              <Tooltip formatter={(v) => v.toFixed(3)} />
              <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                {Object.keys(safety.feature_importances).map((_, i) => (
                  <Cell key={i} fill={SEQ[Math.min(SEQ.length - 1, i)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* --- DBSCAN zone discovery --- */}
      <Card title="DBSCAN — High-Risk Zone Discovery">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Metric label="Points" value={zones.n_points} />
          <Metric label="Clusters Found" value={zones.n_clusters} />
          <Metric label="Noise Points" value={zones.n_noise} />
          <Metric label="Silhouette" value={zones.silhouette} />
          <Metric label="eps (deg)" value={zones.eps_deg} />
        </div>
        <div className="text-xs text-slate-500 mt-3">
          Each dense cluster of historical incidents becomes an auto-discovered
          high-risk zone polygon (source="auto" on the live map), seeded from{' '}
          {zones.hotzones_file}.
        </div>
      </Card>

      {/* --- artifact roster --- */}
      <Card title="Model Artifacts">
        <div className="space-y-1.5">
          {Object.entries(status.artifacts).map(([file, info]) => (
            <div key={file} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5 last:border-0">
              <div>
                <span className="font-mono text-xs text-slate-500">{file}</span>
                <span className="ml-2 text-slate-700">{info.description}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                info.present ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {info.present ? 'loaded' : 'missing → fallback'}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* --- version history --- */}
      {registry && (
        <Card title="Model Version History">
          <div className="space-y-4">
            {Object.entries(registry).map(([model, info]) => (
              <div key={model}>
                <div className="text-sm font-semibold text-slate-700 capitalize mb-1">
                  {model} <span className="text-xs font-normal text-slate-400">(active: v{info.active_version})</span>
                </div>
                <div className="space-y-1">
                  {[...info.versions].reverse().map((v) => (
                    <div key={v.version}
                      className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg ${
                        v.version === info.active_version ? 'bg-sky-50 border border-sky-200' : 'bg-slate-50'}`}>
                      <span className="font-mono">v{v.version}</span>
                      <span className="text-slate-500">{new Date(v.trained_at).toLocaleString()}</span>
                      <span className="text-slate-400 font-mono">hash {v.dataset_hash}</span>
                      {v.version === info.active_version && (
                        <span className="text-sky-600 font-semibold">active</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* --- drift monitoring --- */}
      {drift && (
        <Card title="Live Traffic Drift (Population Stability Index)">
          {!drift.available ? (
            <div className="text-sm text-slate-400">{drift.reason}</div>
          ) : (
            <div className="space-y-2">
              {drift.features.map((f) => {
                const color = f.verdict === 'stable' ? 'text-green-700 bg-green-50'
                  : f.verdict === 'moderate drift' ? 'text-amber-700 bg-amber-50'
                  : 'text-red-700 bg-red-50'
                return (
                  <div key={f.feature} className="flex items-center justify-between text-sm">
                    <span className="font-mono">{f.feature}</span>
                    <span className="text-xs text-slate-500">
                      {f.n_live} live vs {f.n_reference} training samples
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${color}`}>
                      PSI {f.psi} · {f.verdict}
                    </span>
                  </div>
                )
              })}
              <div className="text-xs text-slate-400 pt-1">
                PSI &lt; 0.1 stable · 0.1-0.25 moderate · &gt;0.25 significant — the
                conventional thresholds this metric is used with.
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
