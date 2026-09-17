import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/hooks/useAuth'
import { ThemeProvider } from '@/hooks/useTheme'
import { ToastProvider } from '@/hooks/useToast'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el elemento #root')

// El ErrorBoundary va por fuera de los proveedores a propósito: así también
// caza un fallo del propio ThemeProvider, ToastProvider o AuthProvider, que de
// otro modo dejaría la página en blanco antes de que exista nada de la app.
//
// El proveedor de datos ya no va aquí: lo monta App cuando hay sesión, para
// que ninguna consulta salga antes de tener con qué identificarse.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
