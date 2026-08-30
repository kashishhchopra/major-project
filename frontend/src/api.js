import axios from 'axios'
import { API_BASE } from './config'

const api = axios.create({ baseURL: API_BASE })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// A plain axios instance for the refresh call itself -- it must NOT go
// through the interceptors above (that would recurse: a 401 on /auth/refresh
// would trigger another refresh attempt). Exported so tests can mock it
// independently of the main `api` instance.
export const bare = axios.create({ baseURL: API_BASE })

function clearSessionAndRedirect() {
  localStorage.removeItem('token')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  if (!location.pathname.startsWith('/login')) location.href = '/login'
}

// Concurrent requests that all 401 at once must trigger exactly one refresh
// call, not one per request -- they share this in-flight promise.
let refreshPromise = null

function refreshAccessToken() {
  if (!refreshPromise) {
    const refreshToken = localStorage.getItem('refreshToken')
    // Both branches MUST clear refreshPromise via .finally(), including the
    // synchronous "no token" rejection -- an earlier version skipped that on
    // this branch, so after the first attempt with no refresh token,
    // refreshPromise stayed permanently set to that rejected promise and
    // every later call (even after a fresh login) reused it forever instead
    // of trying again.
    refreshPromise = (refreshToken
      ? bare.post('/auth/refresh', { refresh_token: refreshToken }).then(({ data }) => {
          localStorage.setItem('token', data.access_token)
          localStorage.setItem('refreshToken', data.refresh_token)
          return data.access_token
        })
      : Promise.reject(new Error('No refresh token'))
    ).finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config
    const isAuthEndpoint = original?.url?.startsWith('/auth/')

    if (err.response?.status === 401 && !isAuthEndpoint && !original._retried) {
      original._retried = true
      try {
        const newAccessToken = await refreshAccessToken()
        original.headers.Authorization = `Bearer ${newAccessToken}`
        return api(original)
      } catch {
        clearSessionAndRedirect()
        return Promise.reject(err)
      }
    }

    if (err.response?.status === 401) {
      clearSessionAndRedirect()
    }
    return Promise.reject(err)
  }
)

export default api
