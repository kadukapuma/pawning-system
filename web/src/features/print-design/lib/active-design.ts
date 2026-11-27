/** Loads the active Print Designer layout for a document and fills in the shared fields. */
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { DesignDocumentKey, DocData, PrintTemplate } from './types'

export interface PrintParty {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  logo?: string | null
  receipt_footer?: string | null
}

interface ActiveDesign {
  template: PrintTemplate | null
  company: PrintParty | null
  branch: PrintParty | null
}

export interface PrintDesignState {
  status: 'loading' | 'standard' | 'custom' | 'error'
  design: ActiveDesign | null
  /** Safe to print: the standard layout, or the custom one once laid out. */
  canPrint: boolean
  onLaidOut: () => void
}

export function usePrintDesign(key: DesignDocumentKey): PrintDesignState {
  const [loaded, setLoaded] = useState<{ key: DesignDocumentKey; design: ActiveDesign | null } | null>(null)
  const [laidOut, setLaidOut] = useState(false)

  useEffect(() => {
    let active = true
    api
      .get<{ data: ActiveDesign }>(`/api/v1/print-designs/${key}`)
      .then((res) => active && setLoaded({ key, design: res.data.data ?? null }))
      .catch(() => active && setLoaded({ key, design: null }))
    return () => {
      active = false
    }
  }, [key])

  const onLaidOut = useCallback(() => setLaidOut(true), [])
  const current = loaded?.key === key ? loaded : null
  const status = !current ? 'loading' : !current.design ? 'error' : current.design.template ? 'custom' : 'standard'

  return {
    status,
    design: current?.design ?? null,
    canPrint: status === 'standard' || status === 'error' || (status === 'custom' && laidOut),
    onLaidOut,
  }
}

/** Adds the values every document shares: company, branch and print time. */
export function withCommonFields(data: DocData, company: PrintParty | null | undefined, branch: PrintParty | null | undefined): DocData {
  return {
    ...data,
    logo: company?.logo ?? null,
    fields: {
      ...data.fields,
      'company.name': company?.name || '',
      'company.address': company?.address || branch?.address || '',
      'company.phone': company?.phone || branch?.phone || '',
      'company.email': company?.email || '',
      'company.receipt_footer': company?.receipt_footer || '',
      'branch.name': branch?.name || '',
      'branch.phone': branch?.phone || '',
      'branch.address': branch?.address || '',
      printed_at: new Date().toLocaleString(),
    },
  }
}
