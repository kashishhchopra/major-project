import { createContext, useContext, useState } from 'react'
import api from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      // Corrupted/stale entry (e.g. left over from an earlier app version) --
      // drop it rather than crash the whole app on mount.
      localStorage.removeItem('user')
      return null
    }
  })

  const login = async (email, password) => {
    const form = new URLSearchParams()
    form.append('username', email)
    form.append('password', password)
    const { data } = await api.post('/auth/login', form)
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('refreshToken', data.refresh_token)
    const u = {
      role: data.role,
      tourist_id: data.tourist_id,
      full_name: data.full_name,
      email,
    }
    localStorage.setItem('user', JSON.stringify(u))
    setUser(u)
    return u
  }

  const logout = () => {
    const refreshToken = localStorage.getItem('refreshToken')
    // Best-effort revocation -- fire and forget. Local state is cleared
    // regardless of whether this call succeeds, since the user is leaving
    // either way; if it fails, the refresh token still expires naturally.
    if (refreshToken) {
      api.post('/auth/logout', { refresh_token: refreshToken }).catch(() => {})
    }
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
