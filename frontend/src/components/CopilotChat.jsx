import { forwardRef, useImperativeHandle, useState } from 'react'
import api from '../api'

// AI Safety Copilot: a small chat panel shared by the control-room (against
// /copilot/ask) and the tourist app (against /tourists/{id}/copilot/ask).
// See app/services/copilot.py for the intent router behind both.
//
// Exposes an imperative `open()` via ref so something other than its own
// floating button can trigger it -- e.g. the tourist dashboard hub's "Ask AI"
// card opens this exact same widget instead of duplicating a second one.
const CopilotChat = forwardRef(function CopilotChat(
  { endpoint, suggestions = [], title = 'Ask AI', placeholder = 'Ask a question…' }, ref
) {
  const [open, setOpen] = useState(false)
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), [])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const ask = async (question) => {
    if (!question.trim() || loading) return
    setMessages((m) => [...m, { role: 'user', text: question }])
    setInput('')
    setLoading(true)
    try {
      const { data } = await api.post(endpoint, { question })
      setMessages((m) => [...m, { role: 'assistant', text: data.answer }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Sorry, I could not process that just now.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-[1500] bg-sky-600 hover:bg-sky-700 text-white rounded-full w-14 h-14 shadow-lg flex items-center justify-center text-2xl">
        🤖
      </button>

      {open && (
        <div className="fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4"
          onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-800 w-full md:max-w-md md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col"
            style={{ height: 'min(600px, 85vh)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <div className="font-semibold text-slate-800 dark:text-slate-100">🤖 {title}</div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-sm text-slate-400">
                  <p className="mb-2">Try asking:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button key={s} onClick={() => ask(s)}
                        className="text-xs bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 rounded-full px-3 py-1.5 hover:bg-sky-100 dark:hover:bg-sky-900/50">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line ${
                    m.role === 'user'
                      ? 'bg-sky-600 text-white rounded-br-sm'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm'}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-slate-400">
                    thinking…
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); ask(input) }}
              className="flex items-center gap-2 p-3 border-t border-slate-100 dark:border-slate-700">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder}
                className="flex-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-full px-4 py-2 text-sm" />
              <button type="submit" disabled={loading || !input.trim()}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-full w-9 h-9 flex items-center justify-center shrink-0">
                ➤
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
})

export default CopilotChat
