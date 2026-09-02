import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../auth.jsx'
import { COUNTRIES } from '../lib/countries.js'

const DOC_TYPES = [
  { value: '', label: 'Select Verification Method' },
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'passport', label: 'Passport' },
  { value: 'voterid', label: 'Voter ID' },
  { value: 'pan', label: 'PAN' },
]

const VISA_TYPES = ['e-Visa', 'Tourist', 'Business', 'Medical', 'Conference']

// Step list is built per-registration rather than a fixed array: a
// passport-type registration (foreign tourist) needs a "Visa & Travel" step
// the domestic-document flow doesn't. Keyed by a stable id (not index) so
// validators/render logic can't drift out of sync when the array's shape
// changes based on document_type -- see useMemo below.
function buildSteps(documentType) {
  const steps = [
    { key: 'identity', label: 'Identity' },
    { key: 'document', label: 'Document' },
  ]
  if (documentType === 'passport') {
    steps.push({ key: 'visa', label: 'Visa & Travel' })
  }
  steps.push(
    { key: 'photo', label: 'Photo' },
    { key: 'trip', label: 'Trip' },
    { key: 'emergency', label: 'Emergency Contact' },
    { key: 'account', label: 'Account' },
  )
  return steps
}

// Downscales+recompresses so a phone-camera photo doesn't bloat the request
// (stored as a data: URI column -- see backend/app/models/tourist.py).
function _resizePhoto(dataUrl, maxSize = 480) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

function GlobeShell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#04070d' }}>
      <style>{`
        .reg-globe { position: relative; width: 260px; height: 260px; border-radius: 50%;
          background: radial-gradient(circle at 32% 28%, #4fd1ff 0%, #0ea5e9 28%, #075985 55%, #03203a 78%, #01111f 100%);
          box-shadow: 0 0 70px rgba(14,165,233,0.4), inset -24px -16px 50px rgba(0,0,0,0.55);
        }
        .reg-globe::before { content:''; position:absolute; inset:0; opacity:.5;
          background-image:
            radial-gradient(circle at 20% 40%, rgba(255,255,255,0.18) 0 3%, transparent 4%),
            radial-gradient(circle at 60% 20%, rgba(255,255,255,0.14) 0 5%, transparent 6%),
            radial-gradient(circle at 75% 65%, rgba(255,255,255,0.16) 0 4%, transparent 5%);
        }
        .reg-input { background: transparent; border: 1px solid rgba(148,163,184,0.4); color: #e6f1ff; }
        .reg-input::placeholder { color: rgba(230,241,255,0.4); }
        .reg-input:focus { outline: none; border-color: #22d3ee; }
        .reg-input option { color: #0f172a; }
      `}</style>
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="hidden md:flex justify-center">
          <div className="reg-globe"></div>
        </div>
        <div className="text-white">{children}</div>
      </div>
    </div>
  )
}

function StepDots({ steps, activeKey }) {
  const activeIndex = steps.findIndex((s) => s.key === activeKey)
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((s, i) => (
        <div key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= activeIndex ? 'bg-cyan-400' : 'bg-white/15'}`} title={s.label}></div>
      ))}
    </div>
  )
}

// Live camera capture -- no file upload, matching the Digital Tourist Safety
// ID's photo requirement (a real-time capture, not an arbitrary picture).
function LivePhotoCapture({ photo, onCapture, onRetake }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    if (photo) return undefined
    let cancelled = false
    setError('')
    setReady(false)
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
          setReady(true)
        }
      })
      .catch(() => setError('Camera access is required to capture your Digital ID photo. Please allow camera access and retry.'))
    return () => { cancelled = true; stop() }
  }, [photo])

  const capture = async () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    stop()
    onCapture(await _resizePhoto(dataUrl))
  }

  if (photo) {
    return (
      <div className="flex items-center gap-4">
        <img src={photo} alt="Captured" className="w-28 h-28 rounded-xl object-cover border border-white/20" />
        <button type="button" onClick={onRetake}
          className="text-xs font-semibold bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-2 rounded-lg">
          Retake photo
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative w-full max-w-xs mx-auto rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '1/1' }}>
        <video ref={videoRef} muted playsInline className="w-full h-full object-cover -scale-x-100" />
      </div>
      {error && <div className="text-xs text-red-300 text-center">{error}</div>}
      <button type="button" onClick={capture} disabled={!ready}
        className="w-full bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-900 font-bold py-2 rounded-lg disabled:opacity-50">
        📸 Capture Photo
      </button>
    </div>
  )
}

export default function Register() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({
    full_name: '', nationality: 'Indian', document_type: '',
    document_number: '', phone: '', email: '', password: '',
    trip_start: '', trip_end: '', hotel: '', photo: null,
    nationality_code: '', visa_type: '', visa_number: '', visa_expiry: '', passport_expiry: '',
  })
  const steps = useMemo(() => buildSteps(f.document_type), [f.document_type])
  const [stepKey, setStepKey] = useState('identity')
  const [contact, setContact] = useState({ name: '', phone: '', relation: 'family' })
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const validators = {
    identity: () => f.full_name.trim().length >= 2 && f.document_type,
    document: () => f.document_number.trim().length >= 4 && f.phone.trim().length >= 3,
    visa: () => f.nationality_code && f.visa_type && f.visa_expiry,
    photo: () => !!f.photo, // live camera capture is mandatory for the Digital ID card
    trip: () => f.trip_start && f.trip_end && new Date(f.trip_end) > new Date(f.trip_start),
    emergency: () => true, // optional
    account: () => true, // optional
  }
  const stepIndex = steps.findIndex((s) => s.key === stepKey)
  const canAdvance = validators[stepKey]()

  const next = () => {
    if (!canAdvance) {
      setError('Please fill in the required fields to continue.')
      return
    }
    setError('')
    const nextIndex = Math.min(stepIndex + 1, steps.length - 1)
    setStepKey(steps[nextIndex].key)
  }
  const back = () => {
    setError('')
    const prevIndex = Math.max(stepIndex - 1, 0)
    setStepKey(steps[prevIndex].key)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = {
        full_name: f.full_name,
        nationality: f.document_type === 'passport'
          ? (COUNTRIES.find((c) => c.code === f.nationality_code)?.name || f.nationality_code)
          : f.nationality,
        document_type: f.document_type,
        document_number: f.document_number,
        phone: f.phone,
        photo: f.photo || null,
        hotel: f.hotel || null,
        email: f.email || null,
        password: f.password || null,
        trip_start: new Date(f.trip_start).toISOString(),
        trip_end: new Date(f.trip_end).toISOString(),
        emergency_contacts: contact.name && contact.phone ? [contact] : [],
        itinerary: [],
      }
      if (f.document_type === 'passport') {
        payload.visa_type = f.visa_type
        payload.visa_number = f.visa_number || null
        payload.visa_expiry = f.visa_expiry ? new Date(f.visa_expiry).toISOString() : null
        payload.passport_expiry = f.passport_expiry ? new Date(f.passport_expiry).toISOString() : null
      }
      const { data } = await api.post('/tourists', payload)
      setResult(data)
      if (f.email && f.password) {
        setTimeout(async () => {
          const u = await login(f.email, f.password)
          nav(u.role === 'admin' ? '/admin' : '/app')
        }, 1600)
      }
    } catch (err) {
      const d = err.response?.data?.detail
      setError(typeof d === 'string' ? d : (Array.isArray(d) ? d.map((x) => x.msg).join('; ') : 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <GlobeShell>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center backdrop-blur-sm">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-xl font-bold">Your Unique Blockchain ID</h1>
          <div className="mt-3 text-2xl font-mono font-bold text-cyan-300 tracking-wider">{result.digital_id}</div>
          <p className="text-sm text-slate-300 mt-3">
            Anchored as the genesis block of your tamper-evident ID chain.
            Valid until {new Date(result.trip_end).toLocaleDateString()}.
          </p>
          <p className="text-sm text-slate-400 mt-1">{f.email ? 'Signing you in…' : ''}</p>
          {!f.email && (
            <Link to="/login" className="inline-block mt-5 bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-900 font-bold px-6 py-2.5 rounded-xl">
              Continue to Login
            </Link>
          )}
        </div>
      </GlobeShell>
    )
  }

  const label = 'text-sm font-medium text-slate-300'
  const input = `reg-input mt-1 w-full rounded-lg px-3 py-2.5`
  const activeLabel = steps[stepIndex]?.label

  return (
    <GlobeShell>
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Identity Verification</h1>
          <Link to="/login" className="text-xs text-slate-400 hover:text-slate-200">Back to login</Link>
        </div>
        <p className="text-xs text-slate-400 mb-5">Step {stepIndex + 1} of {steps.length} — {activeLabel}</p>
        <StepDots steps={steps} activeKey={stepKey} />

        <form onSubmit={stepKey === 'account' ? submit : (e) => { e.preventDefault(); next() }} className="space-y-4">
          {stepKey === 'identity' && (
            <>
              <label className={label}>Enter Full Name
                <input className={input} value={f.full_name} onChange={set('full_name')}
                  placeholder="Enter Full Name" required minLength={2} /></label>
              <label className={label}>Select Verification Method
                <select className={input} value={f.document_type} onChange={set('document_type')} required>
                  {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select></label>
            </>
          )}

          {stepKey === 'document' && (
            <>
              <label className={label}>{f.document_type ? DOC_TYPES.find((d) => d.value === f.document_type)?.label : 'Document'} Number
                <input className={input} value={f.document_number} onChange={set('document_number')}
                  placeholder="Enter document number" required minLength={4} /></label>
              <label className={label}>Phone
                <input className={input} value={f.phone} onChange={set('phone')} placeholder="+91-90000-00000" required /></label>
              {f.document_type === 'passport' ? (
                <label className={label}>Country of Citizenship
                  <select className={input} value={f.nationality_code} onChange={set('nationality_code')} required>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select></label>
              ) : (
                <label className={label}>Nationality
                  <input className={input} value={f.nationality} onChange={set('nationality')} /></label>
              )}
            </>
          )}

          {stepKey === 'visa' && (
            <>
              <p className="text-xs text-slate-400 -mt-1 mb-2">Required for passport-based registration.</p>
              <label className={label}>Visa Type
                <select className={input} value={f.visa_type} onChange={set('visa_type')} required>
                  <option value="">Select visa type</option>
                  {VISA_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select></label>
              <label className={label}>Visa Number (optional)
                <input className={input} value={f.visa_number} onChange={set('visa_number')}
                  placeholder="Visa number" /></label>
              <label className={label}>Visa Expiry
                <input type="date" className={input} value={f.visa_expiry} onChange={set('visa_expiry')} required /></label>
              <label className={label}>Passport Expiry (optional)
                <input type="date" className={input} value={f.passport_expiry} onChange={set('passport_expiry')} /></label>
              <p className="text-xs text-slate-400">Your visa must be valid through your entire planned trip.</p>
            </>
          )}

          {stepKey === 'photo' && (
            <>
              <p className="text-xs text-slate-400 -mt-1 mb-2">
                Required — a live camera capture for your Digital Tourist Safety ID card (no file uploads, to
                make sure the photo is really of you, right now).
              </p>
              <LivePhotoCapture photo={f.photo}
                onCapture={(photo) => setF((prev) => ({ ...prev, photo }))}
                onRetake={() => setF((prev) => ({ ...prev, photo: null }))} />
            </>
          )}

          {stepKey === 'trip' && (
            <>
              <label className={label}>Trip Start
                <input type="datetime-local" className={input} value={f.trip_start} onChange={set('trip_start')} required /></label>
              <label className={label}>Trip End
                <input type="datetime-local" className={input} value={f.trip_end} onChange={set('trip_end')} required /></label>
              <label className={label}>Hotel / Accommodation
                <input className={input} value={f.hotel} onChange={set('hotel')} placeholder="e.g. ABC Residency" /></label>
              <p className="text-xs text-slate-400">Your digital ID stays valid for exactly this window.</p>
            </>
          )}

          {stepKey === 'emergency' && (
            <>
              <p className="text-xs text-slate-400 -mt-1 mb-2">Optional, but strongly recommended — notified automatically on SOS.</p>
              <label className={label}>Contact name
                <input className={input} value={contact.name}
                  onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Name" /></label>
              <label className={label}>Contact phone
                <input className={input} value={contact.phone}
                  onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="Phone" /></label>
              <label className={label}>Relation
                <input className={input} value={contact.relation}
                  onChange={(e) => setContact({ ...contact, relation: e.target.value })} placeholder="family" /></label>
            </>
          )}

          {stepKey === 'account' && (
            <>
              <p className="text-xs text-slate-400 -mt-1 mb-2">Optional — set credentials to access the tourist app after registering.</p>
              <label className={label}>Email
                <input type="email" className={input} value={f.email} onChange={set('email')} placeholder="you@example.com" /></label>
              <label className={label}>Password (min 8, letters + numbers)
                <input type="password" className={input} value={f.password} onChange={set('password')} /></label>
            </>
          )}

          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2">{error}</div>}

          <div className="flex items-center gap-3 pt-2">
            {stepIndex > 0 && (
              <button type="button" onClick={back}
                className="flex-1 border border-white/20 text-slate-200 font-semibold py-2.5 rounded-lg">
                Back
              </button>
            )}
            <button type="submit" disabled={loading}
              className="flex-[2] bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-900 font-bold py-2.5 rounded-lg disabled:opacity-60">
              {stepKey === 'account'
                ? (loading ? 'Issuing…' : 'Get Your Unique Blockchain ID')
                : 'Next'}
            </button>
          </div>
        </form>
      </div>
    </GlobeShell>
  )
}
