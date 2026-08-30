import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import AdminLayout from './pages/admin/AdminLayout.jsx'
import Dashboard from './pages/admin/Dashboard.jsx'
import TouristSearch from './pages/admin/TouristSearch.jsx'
import Zones from './pages/admin/Zones.jsx'
import Incidents from './pages/admin/Incidents.jsx'
import Analytics from './pages/admin/Analytics.jsx'
import ModelInsights from './pages/admin/ModelInsights.jsx'
import Devices from './pages/admin/Devices.jsx'
import AuditLog from './pages/admin/AuditLog.jsx'
import TouristApp from './pages/tourist/TouristApp.jsx'
import ResponderLayout from './pages/responder/ResponderLayout.jsx'
import ResponderConsole from './pages/responder/ResponderConsole.jsx'

function Protected({ role, children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  const allowed = Array.isArray(role) ? role.includes(user.role) : user.role === role
  if (role && !allowed) return <Navigate to="/" replace />
  return children
}

function Home() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'admin') return <Navigate to="/admin" replace />
  if (user.role === 'responder') return <Navigate to="/responder" replace />
  return <Navigate to="/app" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/" element={<Home />} />

      <Route path="/admin" element={<Protected role="admin"><AdminLayout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="tourists" element={<TouristSearch />} />
        <Route path="zones" element={<Zones />} />
        <Route path="incidents" element={<Incidents />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="model-insights" element={<ModelInsights />} />
        <Route path="devices" element={<Devices />} />
        <Route path="audit" element={<AuditLog />} />
      </Route>

      <Route path="/app" element={<Protected role="tourist"><TouristApp /></Protected>} />

      <Route path="/responder" element={<Protected role="responder"><ResponderLayout /></Protected>}>
        <Route index element={<ResponderConsole />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
