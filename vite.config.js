import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // serve static assets from /zantgrams instead of /public
  publicDir: 'zantgrams',
})
