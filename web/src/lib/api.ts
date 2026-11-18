import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

/**
 * Axios instance for the Laravel API.
 * Sanctum SPA auth: session cookie + XSRF-TOKEN cookie, sent automatically.
 * In dev, Vite proxies /api and /sanctum to Laravel (see vite.config.ts).
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
})

// ---- Working branch -------------------------------------------------------
const BRANCH_KEY = 'sampath.branchId'

export function getSelectedBranchId(): number | null {
  try {
    const v = localStorage.getItem(BRANCH_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function setSelectedBranchId(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(BRANCH_KEY)
    else localStorage.setItem(BRANCH_KEY, String(id))
  } catch {
    /* storage unavailable — fall back to the home branch */
  }
}

api.interceptors.request.use((config) => {
  const branchId = getSelectedBranchId()
  if (branchId) config.headers.set('X-Branch-Id', String(branchId))
  return config
})

// ---- Session expiry / CSRF -------------------------------------------------
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

type RetriableConfig = InternalAxiosRequestConfig & { _csrfRetried?: boolean }

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined
    const status = error.response?.status

    // 419 = CSRF token expired: refresh the cookie and retry once.
    if (status === 419 && config && !config._csrfRetried) {
      config._csrfRetried = true
      await csrfCookie()
      return api(config)
    }

    // 403 on a branch we no longer have access to: go back to the home branch.
    if (status === 403 && (error.response?.data as { message?: string })?.message?.includes('branch')) {
      setSelectedBranchId(null)
    }

    if (status === 401 && !config?.url?.includes('/auth/login')) onUnauthorized?.()
    return Promise.reject(error)
  },
)

/** Must be called once before login so Laravel sets the XSRF cookie. */
export function csrfCookie() {
  return api.get('/sanctum/csrf-cookie')
}

/** First validation message from a Laravel 422 response, or a generic one. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined
    const first = data?.errors ? Object.values(data.errors)[0]?.[0] : undefined
    if (first) return first
    if (error.response?.status === 429) return 'Too many attempts. Please wait a minute and try again.'
    if (data?.message) return data.message
    if (!error.response) return 'Cannot reach the server. Check that the API is running.'
  }
  return fallback
}

export type Ping = { app: string; time: string; timezone: string }
