import { AlertTriangle } from 'lucide-react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui'

/** Shown instead of a blank/developer error page when a screen crashes. */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const message = isRouteErrorResponse(error) ? error.statusText : error instanceof Error ? error.message : String(error)

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto mb-3 size-10 text-warning" />
        <h1 className="text-xl font-semibold">{notFound ? 'Page not found' : 'Something went wrong on this screen'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {notFound ? 'Check the address or use the menu.' : 'Nothing was saved by this error. Try again; if it keeps happening, send this message to support:'}
        </p>
        {!notFound && <pre className="mt-3 overflow-x-auto rounded-md bg-secondary p-3 text-left text-xs">{message}</pre>}
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => window.location.reload()}>Reload</Button>
          <Button onClick={() => (window.location.href = '/')}>Go to dashboard</Button>
        </div>
      </div>
    </div>
  )
}
