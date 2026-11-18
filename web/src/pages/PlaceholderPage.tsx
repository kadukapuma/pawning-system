import { Construction } from 'lucide-react'
import { useLocation } from 'react-router-dom'

export function PlaceholderPage() {
  const { pathname } = useLocation()
  return (
    <div className="grid place-items-center rounded-xl border border-dashed bg-card py-24 text-center">
      <Construction className="mb-3 size-8 text-muted-foreground" />
      <p className="font-medium">Coming in a later phase</p>
      <p className="text-sm text-muted-foreground">{pathname}</p>
    </div>
  )
}
