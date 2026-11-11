import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Сборка браузерной панели стенда PBT-121 (D1): собственная изолированная
 * конфигурация без продуктового bootstrap, PWA, service worker и аналитики.
 * Base path для временного GitHub Pages задаётся переменной AGENT_PROBE_BASE.
 */
export default defineConfig(() => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  base: process.env.AGENT_PROBE_BASE ?? '/',
  build: {
    outDir: fileURLToPath(new URL('../../../.cache/agent-integration/web/', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
}));
