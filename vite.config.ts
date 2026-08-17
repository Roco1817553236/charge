import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['app-icon.svg'],
      manifest: {
        name: '个人记账',
        short_name: '记账',
        description: '本地优先、OneDrive 加密同步的个人记账应用',
        lang: 'zh-CN',
        start_url: './#/entry',
        scope: './',
        display: 'standalone',
        background_color: '#f5f7fb',
        theme_color: '#4f46e5',
        orientation: 'any',
        icons: [
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: false,
        globPatterns: ['**/*.{js,css,html,svg,woff2}']
      }
    })
  ],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './work/coverage'
    }
  }
})
