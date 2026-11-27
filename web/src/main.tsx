import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { Backdrop } from './components/theme/Backdrop'
import { PrintPreviewHost } from './components/print/PrintPreviewHost'
import { ThemedToaster, ThemeProvider } from './components/theme/ThemeProvider'
import { AuthProvider } from './features/auth/AuthProvider'
import './index.css'
import { isEmbedded } from './lib/print'

// Inside the print preview popup: hide toolbars, always render light.
if (isEmbedded()) document.documentElement.classList.add('embedded')

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Backdrop />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <ThemedToaster />
          <PrintPreviewHost />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
