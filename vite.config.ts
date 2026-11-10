import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'framework',
              test: /node_modules[\\/](?:react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/,
              minSize: 0,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              minSize: 20_000,
              maxSize: 350_000,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
