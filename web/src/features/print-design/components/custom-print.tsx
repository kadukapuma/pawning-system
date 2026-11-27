/** Lets a print page use the active Print Designer layout instead of its standard layout. */
import type { ReactNode } from 'react'
import { withCommonFields, type PrintDesignState } from '../lib/active-design'
import type { DocData } from '../lib/types'
import { DesignedDocument } from './designed-document'

/**
 * Shows `children` (the standard layout) unless a design is active for this document,
 * in which case every entry of `documents` prints with that design (one page each).
 */
export function CustomPrint({ state, documents, children }: { state: PrintDesignState; documents: () => DocData[]; children: ReactNode }) {
  if (state.status === 'loading') {
    return <div className="p-12 text-center text-sm text-neutral-500 print:hidden">Preparing document…</div>
  }

  const { design } = state
  if (state.status === 'custom' && design?.template) {
    const template = design.template
    const list = documents().map((data) => withCommonFields(data, design.company, design.branch))

    return (
      // DesignedDocument sets the page size; its @page rule comes after the standard layout's and wins.
      <div className="space-y-6 print:space-y-0">
        {list.map((data, index) => (
          <DesignedDocument key={index} template={template} data={data} onLaidOut={state.onLaidOut} />
        ))}
      </div>
    )
  }

  return (
    <>
      {state.status === 'error' && (
        <div className="no-print mx-auto mb-4 max-w-[148mm] rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not check for a custom print design, so the standard layout is shown. Reload before printing on pre-printed forms.
        </div>
      )}
      {children}
    </>
  )
}
