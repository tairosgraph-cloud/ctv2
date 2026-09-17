import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// `base` es el prefijo con el que Vite escribe las rutas de los assets dentro del
// index.html compilado. Sin definirlo vale '/', es decir, rutas absolutas contra la
// raíz del dominio: el HTML pide /assets/index-abc123.js. Eso sólo funciona si la app
// se sirve en https://dominio/. En cuanto se publica bajo un subdirectorio
// —GitHub Pages en https://usuario.github.io/registro-contable_v2/, una subruta detrás
// de un proxy, o al abrir dist/index.html con file://— el navegador busca esos assets
// en la raíz equivocada y TODOS devuelven 404 (pantalla en blanco).
//
// Con './' Vite genera rutas relativas al propio index.html, así que el mismo `dist`
// vale tal cual en la raíz del dominio y en cualquier subruta, sin recompilar ni saber
// de antemano dónde se va a desplegar.
//
// Es seguro aquí porque la app NO usa enrutador de cliente: las pestañas son estado de
// React y sólo existe una URL, la del index.html. Si algún día se añade react-router con
// rutas anidadas (/informes/2026), las rutas relativas se resolverían contra la URL
// visitada y volverían a romperse; para ese caso se deja el escape por variable de
// entorno: BASE_PATH=/registro-contable_v2/ npm run build (con barra inicial y final).
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
})
