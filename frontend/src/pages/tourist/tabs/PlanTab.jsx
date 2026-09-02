import { useTranslation } from 'react-i18next'
import { Card } from '../../../components/ui.jsx'
import RiskForecastStrip from '../../../components/RiskForecastStrip.jsx'
import RoutePicker from '../../../components/RoutePicker.jsx'
import CheckInCard from '../../../components/CheckInCard.jsx'

// Everything about planning ahead: how risk changes over the next hour,
// picking a safer route, the itinerary, and check-in/out. The route-picker
// state itself is shared with HomeTab's map (see useTouristData.js) since
// destination-picking happens by tapping the map and only one tab is
// mounted at a time.
export default function PlanTab({ data }) {
  const { t } = useTranslation()
  const { me, riskForecast, tid, routePicker, routePickerOpen, setRoutePickerOpen } = data

  return (
    <div className="space-y-4">
      <RiskForecastStrip forecast={riskForecast} />

      <button onClick={() => setRoutePickerOpen((v) => !v)}
        className="w-full text-sm font-semibold text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 rounded-xl py-2">
        {routePickerOpen ? 'Hide safe route planner' : '🧭 Plan a safe route'}
      </button>
      <RoutePicker active={routePickerOpen} onToggle={() => setRoutePickerOpen(false)} state={routePicker} />

      <Card title={t('itinerary.title')}>
        <ol className="space-y-2">
          {me.itinerary?.map((w, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className={`w-2.5 h-2.5 rounded-full ${i === 0 ? 'bg-sky-500' : 'bg-slate-300'}`}></span>
              <span className={i === 0 ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}>{w.name}</span>
              {i === 0 && <span className="text-xs text-sky-600 ml-auto">{t('itinerary.next_stop')}</span>}
            </li>
          ))}
        </ol>
      </Card>

      <CheckInCard touristId={tid} />
    </div>
  )
}
