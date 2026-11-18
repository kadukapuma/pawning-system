import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, errorMessage } from './api'
import type { Lookups } from './types'

/** Dropdown data (branches, karats, schemes, ...). Refetched after master edits. */
export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: async () => (await api.get<{ data: Lookups }>('/api/v1/lookups')).data.data,
    staleTime: 10 * 60_000,
  })
}

/** GET returning `{ data: T }`. */
export function useApiQuery<T>(key: QueryKey, url: string, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ data: T }>(url)).data.data,
    enabled,
  })
}

/**
 * POST/PUT helper: shows a toast, invalidates the given query keys and maps
 * Laravel 422 errors to a `fieldErrors` object for forms.
 */
export function useApiMutation<TBody, TResult = unknown>(opts: {
  method?: 'post' | 'put'
  url: string | ((body: TBody) => string)
  invalidate?: QueryKey[]
  success?: string
  onSuccess?: (result: TResult) => void
}) {
  const qc = useQueryClient()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: async (body: TBody) => {
      const url = typeof opts.url === 'function' ? opts.url(body) : opts.url
      const res = await api[opts.method ?? 'post']<{ data: TResult }>(url, body)
      return res.data.data
    },
    onMutate: () => setFieldErrors({}),
    onSuccess: async (result) => {
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })))
      if (opts.success) toast.success(opts.success)
      opts.onSuccess?.(result)
    },
    onError: (e: unknown) => {
      const errors = (e as { response?: { status?: number; data?: { errors?: Record<string, string[]> } } }).response
      if (errors?.status === 422 && errors.data?.errors) {
        setFieldErrors(Object.fromEntries(Object.entries(errors.data.errors).map(([k, v]) => [k, v[0]])))
      }
      toast.error(errorMessage(e))
    },
  })

  return { ...mutation, fieldErrors, clearErrors: () => setFieldErrors({}) }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
