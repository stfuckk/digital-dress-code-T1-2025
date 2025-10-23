import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild', // Используем esbuild вместо terser
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['vue'],
          'ml': ['@tensorflow/tfjs', '@tensorflow-models/body-pix']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
})

