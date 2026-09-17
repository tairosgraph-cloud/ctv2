import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ThemeProvider } from '@/hooks/useTheme'
import { ToastProvider } from '@/hooks/useToast'
import { DataProvider } from '@/store/DataProvider'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el elemento #root')

// El ErrorBoundary va por fuera de los proveedores a propósito: así también
// caza un fallo del propio ThemeProvider, ToastProvider o DataProvider, que de
// otro modo dejaría la página en blanco antes de que exista nada de la app.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
