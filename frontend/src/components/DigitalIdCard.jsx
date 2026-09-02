import { useEffect, useState } from 'react'
import api from '../api'
import { Card } from './ui.jsx'

const STATUS_META = {
  active: { icon: '🟢', label: 'ID VERIFIED', cls: 'text-green-600 dark:text-green-400' },
  expiring_soon: { icon: '🟡', label: 'EXPIRING SOON', cls: 'text-yellow-600 dark:text-yellow-400' },
  expired: { icon: '⚫', label: 'EXPIRED', cls: 'text-slate-500 dark:text-slate-400' },
  invalidated: { icon: '🔴', label: 'INVALIDATED', cls: 'text-red-600 dark:text-red-400' },
}

// The Digital Tourist Safety ID card -- a government-credential-style card
// with photo + secure QR, not just a profile page. The QR encodes only an
// opaque token (never the tourist's actual information); a scanner only
// learns anything after the backend verifies that token and checks the
// scanner's own role -- see backend/services/tourist_id.py.
export default function DigitalIdCard({ touristId }) {
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/tourists/${touristId}/digital-id`)
      setCard(data)
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !card) load()
  }

  const regenerate = async () => {
    setRegenerating(true)
    try {
      const { data } = await api.post(`/tourists/${touristId}/digital-id/regenerate`)
      setCard(data)
      setConfirmRegen(false)
    } finally {
      setRegenerating(false)
    }
  }

  useEffect(() => { setCard(null) }, [touristId])

  const meta = card ? (STATUS_META[card.id_status] || STATUS_META.active) : null

  return (
    <div>
      <button onClick={toggle}
        className="w-full text-sm font-semibold text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 rounded-xl py-2">
        {open ? 'Hide Digital Safety ID ▲' : '🪪 Digital Tourist Safety ID'}
      </button>

      {open && (
        <div className="mt-3">
          {loading && !card && <div className="text-sm text-slate-400 text-center py-4">Loading…</div>}
          {card && (
            <Card>
              <div className="text-center text-xs font-bold tracking-widest text-slate-400 mb-3">
                DIGITAL TOURIST SAFETY ID
              </div>
              <div className="flex gap-4 items-start justify-center">
                {card.photo ? (
                  <img src={card.photo} alt="Tourist photo"
                    className="w-24 h-24 rounded-xl object-cover border border-slate-200 dark:border-slate-600 shrink-0" />
                ) : (
                  <div className="w-24 h-24 rounded-xl bg-slate-100 dark:bg-slate-700 shrink-0 flex items-center justify-center text-3xl">🪪</div>
                )}
                {card.qr_png_base64 ? (
                  <img src={card.qr_png_base64} alt="Digital ID QR code"
                    className="w-24 h-24 border border-slate-200 dark:border-slate-600 rounded-lg shrink-0 bg-white p-1" />
                ) : (
                  <div className="w-24 h-24 rounded-lg bg-slate-100 dark:bg-slate-700 shrink-0 flex items-center justify-center text-xs text-slate-400 text-center p-1">
                    QR unavailable
                  </div>
                )}
              </div>

              <div className="text-center mt-3">
                <div className="font-bold text-lg text-slate-800 dark:text-slate-100">{card.full_name}</div>
                <div className="text-sm mt-1"><span className="text-slate-400">Tourist ID:</span> <span className="font-mono">{card.digital_id}</span></div>
                {card.hotel && <div className="text-sm"><span className="text-slate-400">Hotel:</span> {card.hotel}</div>}
                <div className="text-sm text-slate-400">
                  {new Date(card.trip_start).toLocaleDateString()} → {new Date(card.trip_end).toLocaleDateString()}
                </div>
                <div className={`text-sm font-bold mt-2 flex items-center justify-center gap-1.5 ${meta.cls}`}>
                  <span>{meta.icon}</span>{meta.label}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-center gap-2">
                {!confirmRegen ? (
                  <button onClick={() => setConfirmRegen(true)}
                    className="text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 font-semibold px-3 py-1.5 rounded-lg">
                    Regenerate QR
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-slate-500">Old QR stops working immediately. Continue?</span>
                    <button onClick={regenerate} disabled={regenerating}
                      className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg">
                      {regenerating ? 'Regenerating…' : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmRegen(false)}
                      className="text-xs text-slate-500 hover:underline">Cancel</button>
                  </>
                )}
              </div>
              <div className="mt-2 text-[11px] text-slate-400 text-center">
                The QR carries only a secure token — a scanner only sees your information
                after the backend verifies it and checks their authorization.
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
