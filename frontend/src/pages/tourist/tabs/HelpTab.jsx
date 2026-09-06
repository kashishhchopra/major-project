import { useTranslation } from 'react-i18next'
import { Card } from '../../../components/ui.jsx'
import SafetyCardPanel from '../../../components/SafetyCardPanel.jsx'
import ConsularCard from '../../../components/ConsularCard.jsx'
import NearbyPlacesCard from '../../../components/NearbyPlacesCard.jsx'
import TranslateCard from '../../../components/TranslateCard.jsx'

// Everything a tourist reaches for in a moment of trouble that isn't the SOS
// button itself: offline emergency numbers, nearby police/hospital/pharmacy/
// transport, embassy contact for foreign tourists, on-the-spot translation,
// and the AI helper.
export default function HelpTab({ data, onAskAI }) {
  const { t } = useTranslation()
  const { nearby } = data

  return (
    <div className="space-y-4">
      <SafetyCardPanel touristId={data.tid} />
      <ConsularCard touristId={data.tid} />
      <NearbyPlacesCard touristId={data.tid} />
      <TranslateCard />

      <Card title={t('police.title')}>
        <ul className="space-y-2">
          {nearby.map((u) => (
            <li key={u.id} className="flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{u.station} · ☎ {u.phone}</div>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">{u.dist.toFixed(1)} km</span>
            </li>
          ))}
        </ul>
      </Card>

      <button onClick={onAskAI}
        className="w-full text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl py-3">
        💬 Ask the Safety Helper
      </button>
    </div>
  )
}
