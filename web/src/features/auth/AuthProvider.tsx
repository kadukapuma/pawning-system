import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { api, csrfCookie, getSelectedBranchId, setSelectedBranchId, setUnauthorizedHandler } from '@/lib/api'

export type Branch = { id: number; code: string; name: string; address: string | null; phone: string | null }

export type AuthUser = {
  id: number
  username: string
  name: string
  email: string | null
  phone: string | null
  home_branch_id: number
  current_branch_id: number
  branches: Branch[]
  roles: string[]
  permissions: string[]
  last_login_at: string | null
}

type AuthContextValue = {
  user: AuthUser | null
  isLoading: boolean
  currentBranch: Branch | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  switchBranch: (branchId: number) => Promise<void>
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)
const ME_KEY = ['auth', 'me'] as const

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { data } = await api.get<{ data: AuthUser }>('/api/v1/auth/me')
    return data.data
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 401) return null
    throw e
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 5 * 60_000, retry: false })
  const user = me.data ?? null

  // Session expired anywhere in the app → treat as signed out.
  useEffect(() => {
    setUnauthorizedHandler(() => queryClient.setQueryData(ME_KEY, null))
  }, [queryClient])

  // Drop a stored branch the user can no longer access.
  useEffect(() => {
    const stored = getSelectedBranchId()
    if (user && stored && !user.branches.some((b) => b.id === stored)) setSelectedBranchId(null)
  }, [user])

  const login = useCallback(
    async (username: string, password: string) => {
      setSelectedBranchId(null)
      await csrfCookie()
      const { data } = await api.post<{ data: AuthUser }>('/api/v1/auth/login', { username, password })
      // Clear branch/data caches after login, but keep the auth user cache intact.
      // Clearing ME_KEY before setQueryData can briefly return the app to loading
      // and make the login redirect depend on a page refresh.
      await queryClient.cancelQueries()
      queryClient.removeQueries({ predicate: (query) => {
        const key = query.queryKey
        return !(key[0] === 'auth' && key[1] === 'me')
      } })
      queryClient.setQueryData(ME_KEY, data.data)
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/api/v1/auth/logout')
    } finally {
      setSelectedBranchId(null)
      queryClient.clear()
      queryClient.setQueryData(ME_KEY, null)
    }
  }, [queryClient])

  const switchBranch = useCallback(
    async (branchId: number) => {
      setSelectedBranchId(branchId)
      // Every cached query belongs to the old branch.
      await queryClient.invalidateQueries()
    },
    [queryClient],
  )

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(user?.permissions ?? [])
    return {
      user,
      isLoading: me.isPending,
      currentBranch: user?.branches.find((b) => b.id === user.current_branch_id) ?? null,
      login,
      logout,
      switchBranch,
      can: (p: string) => permissions.has(p),
    }
  }, [user, me.isPending, login, logout, switchBranch])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
