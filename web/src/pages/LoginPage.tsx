import { zodResolver } from '@hookform/resolvers/zod'
import { Gem, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '@/features/auth/AuthProvider'
import { errorMessage } from '@/lib/api'

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
})
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { username: '', password: '' } })
  const { errors, isSubmitting } = form.formState

  if (user) return <Navigate to={from} replace />

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      await login(values.username, values.password)
    } catch (e) {
      setServerError(errorMessage(e))
    }
  })

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive'

  return (
    <div className="grid min-h-screen place-items-center bg-sidebar p-4">
      <form noValidate onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Gem className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">Sampath Pawning</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        {serverError && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError}
          </p>
        )}

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Username</span>
          <input
            {...form.register('username')}
            autoComplete="username"
            autoFocus
            aria-invalid={!!errors.username}
            className={inputClass}
          />
          {errors.username && <span className="text-xs text-destructive">{errors.username.message}</span>}
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Password</span>
          <input
            {...form.register('password')}
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            className={inputClass}
          />
          {errors.password && <span className="text-xs text-destructive">{errors.password.message}</span>}
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Sign in
        </button>
      </form>
    </div>
  )
}
