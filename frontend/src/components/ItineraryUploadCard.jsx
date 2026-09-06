import { useRef, useState } from 'react'
import { Card } from './ui.jsx'
import { uploadItineraryDocument, updateItineraryDocument, confirmItineraryDocument } from '../lib/itineraryService.js'
import { geocodePlace } from '../lib/mapsService.js'

// Itinerary document upload: PDF/DOCX/text/photo -> real text extraction
// (OCR for photos, via a local Tesseract engine -- see
// backend/app/services/itinerary_extract.py) -> heuristic structured parse
// (destinations/hotels/transport/activities). The tourist always reviews
// and can edit before anything is written into their real itinerary
// (Tourist.itinerary, what the map/route/AI-copilot already read from);
// extraction is a heuristic, not a guarantee, so this step is never skipped.
export default function ItineraryUploadCard({ touristId, onConfirmed }) {
  const [open, setOpen] = useState(false)
  const [doc, setDoc] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [unresolvedCount, setUnresolvedCount] = useState(0)
  const [locating, setLocating] = useState(null) // index currently being located
  const [autoProgress, setAutoProgress] = useState(null) // {done, total} while auto-locating
  const fileRef = useRef(null)

  // Locate every destination the parser couldn't already place, one at a
  // time (politeness towards the free Nominatim geocoding service, and so
  // the tourist sees live progress rather than a long silent pause) --
  // this is what turns "18 stops need locating" into "done automatically"
  // instead of 18 manual taps.
  const autoLocateAll = async (destinations) => {
    const todo = destinations
      .map((d, i) => i)
      .filter((i) => destinations[i].lat == null && destinations[i].name?.trim())
    if (!todo.length) return
    setAutoProgress({ done: 0, total: todo.length })
    let current = destinations
    for (let n = 0; n < todo.length; n++) {
      const i = todo[n]
      try {
        const result = await geocodePlace(current[i].name.trim())
        current = current.map((d, j) => (j === i ? { ...d, lat: result.lat, lng: result.lng, location_demo: result.demo } : d))
        setDoc((prev) => prev && { ...prev, extracted: { ...prev.extracted, destinations: current } })
      } catch {
        // leave that one unresolved -- never fabricate a location
      }
      setAutoProgress({ done: n + 1, total: todo.length })
    }
    setAutoProgress(null)
  }

  const upload = async (file) => {
    setError('')
    setUploading(true)
    setConfirmed(false)
    try {
      const data = await uploadItineraryDocument(touristId, file)
      setDoc(data)
      if (data.status === 'failed') setError(data.error)
      else await autoLocateAll(data.extracted.destinations)
    } catch (err) {
      const timedOut = err.code === 'ECONNABORTED'
      setError(
        err.response?.data?.detail
          || (timedOut ? "This is taking too long. Try a smaller/clearer photo, or a PDF/DOCX/text file instead." : 'Upload failed. Please try again.')
      )
    } finally {
      setUploading(false)
    }
  }

  const updateDestination = (i, name) => {
    const next = { ...doc, extracted: { ...doc.extracted, destinations: [...doc.extracted.destinations] } }
    // The old lat/lng belonged to the old name -- editing the text makes it
    // stale, so drop it rather than silently keep pointing at the wrong
    // place. The tourist re-locates it (or the auto-locate-on-blur below
    // finds it) before it can be saved into the real itinerary.
    next.extracted.destinations[i] = { ...next.extracted.destinations[i], name, lat: null, lng: null, location_demo: null }
    setDoc(next)
  }
  const removeDestination = (i) => {
    const next = { ...doc, extracted: { ...doc.extracted, destinations: doc.extracted.destinations.filter((_, j) => j !== i) } }
    setDoc(next)
  }
  const addDestination = () => {
    const next = { ...doc, extracted: { ...doc.extracted, destinations: [...doc.extracted.destinations, { name: '' }] } }
    setDoc(next)
  }

  const locateDestination = async (i) => {
    const name = doc.extracted.destinations[i].name.trim()
    if (!name) return
    setLocating(i)
    try {
      const result = await geocodePlace(name)
      const next = { ...doc, extracted: { ...doc.extracted, destinations: [...doc.extracted.destinations] } }
      next.extracted.destinations[i] = {
        ...next.extracted.destinations[i],
        lat: result.lat, lng: result.lng, location_demo: result.demo,
      }
      setDoc(next)
    } catch {
      // leave it unresolved -- never fabricate a location
    } finally {
      setLocating(null)
    }
  }

  const saveEdits = () => updateItineraryDocument(touristId, doc.id, doc.extracted)

  const confirm = async () => {
    setConfirming(true)
    setError('')
    try {
      // Compute the unresolved count from what we're actually sending
      // (rather than the PATCH response) -- the backend just persists this
      // same list verbatim, so this is exactly what it saw.
      const named = doc.extracted.destinations.filter((d) => d.name?.trim())
      const located = named.filter((d) => d.lat != null && d.lng != null)
      await saveEdits()
      await confirmItineraryDocument(touristId, doc.id)
      setUnresolvedCount(named.length - located.length)
      setConfirmed(true)
      onConfirmed?.()
    } catch {
      setError('Could not save your itinerary. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  const reset = () => {
    setDoc(null)
    setError('')
    setConfirmed(false)
    setUnresolvedCount(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)}
        className="w-full text-sm font-semibold text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 rounded-xl py-2">
        {open ? 'Hide itinerary upload ▲' : '📄 Upload My Itinerary'}
      </button>

      {open && (
        <div className="mt-3">
          <Card title="Upload Itinerary Document">
            {!doc && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Upload a PDF, Word (.docx), text file, or a photo/scan (jpg, png) of your itinerary
                  and we'll pull out your destinations, hotels, and transport automatically. A blurry
                  or handwritten photo may not read perfectly — you can always fix anything wrong
                  on the next screen.
                </p>
                <input ref={fileRef} type="file"
                  accept=".pdf,.docx,.txt,text/plain,application/pdf,.doc,.jpg,.jpeg,.png,.webp,.bmp,.tiff,image/*"
                  onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
                  disabled={uploading}
                  className="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-sky-600 file:text-white file:text-xs file:font-semibold" />
                {uploading && (
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin" />
                    Reading your document… photos can take up to a minute.
                  </div>
                )}
                {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
              </div>
            )}

            {doc && !confirmed && (
              <div className="space-y-3 text-sm">
                {error && (
                  <div className="text-xs text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/30 rounded-lg p-2">
                    ⚠ {error}
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                    Destinations — edit anything that's wrong. Only stops we can place on the
                    map (📍✓) will show up in your Itinerary Tracker and safety checks.
                  </div>
                  {autoProgress && (
                    <div className="text-xs text-sky-600 dark:text-sky-400 mb-1.5">
                      📍 Locating destinations… ({autoProgress.done}/{autoProgress.total})
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {doc.extracted.destinations.map((d, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 w-4">{i + 1}.</span>
                        <input value={d.name} onChange={(e) => updateDestination(i, e.target.value)}
                          disabled={!!autoProgress}
                          className="flex-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded-lg px-2 py-1 text-xs disabled:opacity-60" />
                        {d.lat != null ? (
                          <span className="text-[10px] text-green-600 dark:text-green-400" title="Location found">📍✓</span>
                        ) : (
                          <button onClick={() => locateDestination(i)} disabled={locating === i || !!autoProgress || !d.name?.trim()}
                            className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 disabled:opacity-50 whitespace-nowrap"
                            title="No location found for this stop yet — tap to try to locate it">
                            {locating === i ? 'Locating…' : '📍 Locate'}
                          </button>
                        )}
                        <button onClick={() => removeDestination(i)} disabled={!!autoProgress} className="text-xs text-red-500 disabled:opacity-50">✕</button>
                      </div>
                    ))}
                    {doc.extracted.destinations.length === 0 && (
                      <div className="text-xs text-slate-400">No destinations found — add one, or type your itinerary in the Plan tab manually.</div>
                    )}
                    <div className="flex gap-3">
                      <button onClick={addDestination} disabled={!!autoProgress} className="text-xs text-sky-600 dark:text-sky-400 font-semibold disabled:opacity-50">+ Add destination</button>
                      {doc.extracted.destinations.some((d) => d.lat == null && d.name?.trim()) && (
                        <button onClick={() => autoLocateAll(doc.extracted.destinations)} disabled={!!autoProgress}
                          className="text-xs text-sky-600 dark:text-sky-400 font-semibold disabled:opacity-50">
                          📍 Locate all
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {doc.extracted.hotels.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Hotels</div>
                    {doc.extracted.hotels.map((h, i) => (
                      <div key={i} className="text-xs text-slate-600 dark:text-slate-300">🏨 {h.name}</div>
                    ))}
                  </div>
                )}
                {doc.extracted.transport.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Transport</div>
                    {doc.extracted.transport.map((tp, i) => (
                      <div key={i} className="text-xs text-slate-600 dark:text-slate-300">🚄 {tp.detail}</div>
                    ))}
                  </div>
                )}
                {(doc.extracted.trip_start || doc.extracted.trip_end) && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Trip dates: {doc.extracted.trip_start || '—'} to {doc.extracted.trip_end || '—'}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={confirm} disabled={confirming || !!autoProgress}
                    className="flex-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-semibold py-2 rounded-lg">
                    {confirming ? 'Saving…' : 'Confirm & Save Itinerary'}
                  </button>
                  <button onClick={reset} disabled={!!autoProgress} className="text-xs text-slate-400 disabled:opacity-50">Start over</button>
                </div>
              </div>
            )}

            {confirmed && (
              <div className="text-center py-2 space-y-2">
                <div className="text-green-600 dark:text-green-400 text-sm font-semibold">✓ Itinerary saved</div>
                {unresolvedCount > 0 && (
                  <div className="text-xs text-orange-600 dark:text-orange-400 max-w-xs mx-auto">
                    ⚠ {unresolvedCount} stop{unresolvedCount > 1 ? 's' : ''} couldn't be placed on the map,
                    so {unresolvedCount > 1 ? "they're" : "it's"} not showing in your Itinerary Tracker yet
                    — upload again and use "📍 Locate" to fix that.
                  </div>
                )}
                <button onClick={reset} className="text-xs text-sky-600 dark:text-sky-400">Upload another</button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
