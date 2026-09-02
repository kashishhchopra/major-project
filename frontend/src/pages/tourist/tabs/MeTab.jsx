import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../auth.jsx'
import SafetyPassportCard from '../../../components/SafetyPassportCard.jsx'
import DigitalIdCard from '../../../components/DigitalIdCard.jsx'
import TripGuardianCard from '../../../components/TripGuardianCard.jsx'
import PrivacyCard from '../../../components/PrivacyCard.jsx'
import { DuressPinSettings } from '../../../components/DuressLock.jsx'
import LanguageSwitcher from '../../../components/LanguageSwitcher.jsx'
import ThemeToggle from '../../../components/ThemeToggle.jsx'

// Identity, sharing, and settings -- everything that isn't a moment-to-
// moment safety concern lives here so Home/Plan/Help stay uncluttered.
export default function MeTab({ data }) {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const nav = useNavigate()
  const { tid, tracking, toggleTracking, geo } = data

  return (
    <div className="space-y-4">
      <DigitalIdCard touristId={tid} />
      <SafetyPassportCard touristId={tid} />

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-slate-900 dark:text-slate-100">{t('tracking.title')}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('tracking.subtitle')}</div>
          </div>
          <button onClick={toggleTracking}
            className={`w-14 h-8 rounded-full transition relative ${tracking ? 'bg-green-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${tracking ? 'left-7' : 'left-1'}`}></span>
          </button>
        </div>
        {tracking && geo.permissionState === 'denied' && (
          <div className="mt-2 text-xs text-red-600">
            Location permission denied — enable it in your browser settings to be tracked.
          </div>
        )}
        {tracking && geo.permissionState === 'unsupported' && (
          <div className="mt-2 text-xs text-orange-600">
            This device doesn't support location services.
          </div>
        )}
      </div>

      <TripGuardianCard touristId={tid} />
      <DuressPinSettings touristId={tid} />
      <PrivacyCard touristId={tid} />

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-4 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('lang.label')}</div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>

      <button onClick={() => { logout(); nav('/login') }}
        className="w-full text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-xl py-3">
        {t('app.logout')}
      </button>
    </div>
  )
}
