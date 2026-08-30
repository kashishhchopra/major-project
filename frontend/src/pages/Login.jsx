import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth.jsx'
import { SHOW_DEMO_LOGINS } from '../config'
import LanguageSwitcher from '../components/LanguageSwitcher.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

const DEMO = [
  { label: 'Police / Admin', email: 'admin@tourism.gov.in', password: 'admin123' },
  { label: 'Tourist (Aarav)', email: 'aarav@example.com', password: 'tourist123' },
]

export default function Login() {
  const { login } = useAuth()
  const { t } = useTranslation()
  const nav = useNavigate()
  const [email, setEmail] = useState(SHOW_DEMO_LOGINS ? 'admin@tourism.gov.in' : '')
  const [password, setPassword] = useState(SHOW_DEMO_LOGINS ? 'admin123' : '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const u = await login(email, password)
      nav(u.role === 'admin' ? '/admin' : '/app')
    } catch (err) {
      setError(t('auth.invalid_credentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-600 to-indigo-700 dark:from-slate-900 dark:to-indigo-950 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="flex justify-end mb-2 gap-2">
          <LanguageSwitcher className="!border-slate-200 dark:!border-slate-600 !text-slate-600 dark:!text-slate-300" />
          <ThemeToggle className="!border-slate-200 dark:!border-slate-600 !text-slate-600 dark:!text-slate-300" />
        </div>
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🛡️</div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Smart Tourist Safety</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Monitoring &amp; Incident Response System</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('auth.email')}</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 outline-none"
              type="email" required />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('auth.password')}</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 outline-none"
              type="password" required />
          </div>
          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          <button disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-60">
            {loading ? 'Signing in…' : t('auth.sign_in')}
          </button>
        </form>

        {SHOW_DEMO_LOGINS && (
          <div className="mt-6 border-t border-slate-100 dark:border-slate-700 pt-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Quick demo login:</p>
            <div className="flex gap-2">
              {DEMO.map((d) => (
                <button key={d.email}
                  onClick={() => { setEmail(d.email); setPassword(d.password) }}
                  className="flex-1 text-xs border border-slate-200 dark:border-slate-600 dark:text-slate-300 rounded-lg py-2 hover:bg-slate-50 dark:hover:bg-slate-700">
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-4">
          <Link to="/forgot-password" className="text-sky-600 dark:text-sky-400 font-medium">Forgot password?</Link>
        </p>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-2">
          <Link to="/register" className="text-sky-600 dark:text-sky-400 font-medium">{t('auth.register_prompt')}</Link>
        </p>
      </div>
    </div>
  )
}
