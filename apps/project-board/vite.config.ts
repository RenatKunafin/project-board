import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import colors from './pwa/colors.json';

// Сгенерированы из tokens.css командой npm run generate:pwa-assets.

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false, // PwaStatus регистрирует один SW и следит за активацией.
      includeAssets: ['icons/*.svg', 'icons/*.png', 'icons/*.txt'],
      manifest: {
        id: './',
        name: 'Project Board',
        short_name: 'Project Board',
        description: 'Локальное планирование проектов: Гантт и чек-листы',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: colors.chrome,
        background_color: colors.background,
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cacheId: 'project-board',
        globPatterns: ['**/*.{html,js,css,woff,woff2,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
    {
      name: 'project-board-theme-color',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'theme-color', content: colors.chrome }, injectTo: 'head' }],
    },
  ],
});
