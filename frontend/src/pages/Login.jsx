import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth.jsx'
import { DEMO_LOGINS, SHOW_DEMO_LOGINS } from '../config'
import LanguageSwitcher from '../components/LanguageSwitcher.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

export default function Login() {
  const { login } = useAuth()
  const { t } = useTranslation()
  const nav = useNavigate()
  // Never prefill a password, demo or otherwise -- a shoulder-surfed or
  // screen-shared login screen shouldn't leak a working credential just by
  // being open. Demo buttons (below) still fill both fields on click.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const u = await login(email, password)
      nav(u.role === 'admin' ? '/admin' : u.role === 'responder' ? '/responder' : '/app')
    } catch {
      setError(t('auth.invalid_credentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#04070d' }}>
      <style>{`
        .login-globe { position: relative; width: 260px; height: 260px; border-radius: 50%;
          background: radial-gradient(circle at 32% 28%, #4fd1ff 0%, #0ea5e9 28%, #075985 55%, #03203a 78%, #01111f 100%);
          box-shadow: 0 0 70px rgba(14,165,233,0.4), inset -24px -16px 50px rgba(0,0,0,0.55);
        }
        .login-globe::before { content:''; position:absolute; inset:0; opacity:.5;
          background-image:
            radial-gradient(circle at 20% 40%, rgba(255,255,255,0.18) 0 3%, transparent 4%),
            radial-gradient(circle at 60% 20%, rgba(255,255,255,0.14) 0 5%, transparent 6%),
            radial-gradient(circle at 75% 65%, rgba(255,255,255,0.16) 0 4%, transparent 5%);
        }
      `}</style>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="hidden md:flex justify-center">
          <div className="login-globe"></div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full p-8">
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

          {SHOW_DEMO_LOGINS && DEMO_LOGINS.length > 0 && (
            <div className="mt-6 border-t border-slate-100 dark:border-slate-700 pt-4">
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Quick demo login:</p>
              <div className="flex gap-2">
                {DEMO_LOGINS.map((d) => (
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
          <p className="text-center text-sm mt-4">
            <Link to="/" className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300">← Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
