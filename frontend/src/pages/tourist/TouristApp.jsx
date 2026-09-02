import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth.jsx'
import useTouristData from './useTouristData.js'
import TouristShell from './TouristShell.jsx'
import TouristTabBar from './TouristTabBar.jsx'
import HomeTab from './tabs/HomeTab.jsx'
import PlanTab from './tabs/PlanTab.jsx'
import HelpTab from './tabs/HelpTab.jsx'
import MeTab from './tabs/MeTab.jsx'
import ReportSheet from './tabs/ReportSheet.jsx'
import CopilotChat from '../../components/CopilotChat.jsx'

const TAB_COMPONENTS = { home: HomeTab, plan: PlanTab, help: HelpTab, me: MeTab }

// One calm screen (map + score + SOS) plus a four-tab bottom bar, instead of
// the ~15-card single scroll this used to be. Every feature that lived on
// that scroll still exists -- see useTouristData.js and pages/tourist/tabs/*
// -- only its location changed. All live data/mutations are in
// useTouristData so this component stays a thin shell.
export default function TouristApp() {
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const tid = user.tourist_id
  const [activeTab, setActiveTab] = useState('home')
  const [reportOpen, setReportOpen] = useState(false)
  const copilotRef = useRef(null)
  const data = useTouristData(tid)

  if (!data.ready) {
    return <div className="p-6 text-center text-slate-500 dark:text-slate-400">{i18n.t('app.loading')}</div>
  }

  const ActiveTab = TAB_COMPONENTS[activeTab]

  return (
    <>
      <TouristShell
        digitalId={data.me.digital_id}
        online={data.online}
        toast={data.toast}
        onSOS={data.sendSOS}
        onReport={() => setReportOpen(true)}
        tid={tid}
        posRef={data.posRef}
      >
        <ActiveTab data={{ ...data, tid }} onAskAI={() => copilotRef.current?.open()} />
      </TouristShell>

      <TouristTabBar active={activeTab} onChange={setActiveTab} />

      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        data={data}
        lang={i18n.resolvedLanguage || i18n.language}
      />

      <CopilotChat ref={copilotRef} endpoint={`/tourists/${tid}/copilot/ask`} title="Safety Helper"
        placeholder="e.g. is this area safe?"
        suggestions={['Nearest hospital?', 'Is this area safe?', 'What should I do now?']} />
    </>
  )
}
