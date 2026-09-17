/** @type {import('tailwindcss').Config} */
export default {
  // El tema se activa con la clase `dark` en <html>, que pone useTheme.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4', // faltaba en el HTML original; se usaba 11 veces sin estar definido
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#0a5c53', // Tairos Primary Teal
          900: '#06423d',
          950: '#022c28',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 4s ease-in-out infinite',
        'mic-pulse': 'micPulse 1.8s ease-out infinite',
        'toast-in': 'toastIn 220ms ease-out',
        'gradient-shift': 'gradientShift 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        micPulse: {
          '0%': { boxShadow: '0 0 0 0 rgba(20, 184, 166, 0.7)' },
          '70%': { boxShadow: '0 0 0 16px rgba(20, 184, 166, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(20, 184, 166, 0)' },
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
    },
  },
  plugins: [],
}
