import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const deploymentEnvironment =
    environment.VITE_DEPLOYMENT_ENV ?? (mode === 'production' ? 'production' : 'development');
  const demoModeEnabledForBuild =
    environment.VITE_SEED_DEMO === 'true' &&
    deploymentEnvironment !== 'production' &&
    (mode !== 'production' || deploymentEnvironment === 'staging');

  return {
    define: {
      'import.meta.env.VITE_DEMO_MODE_ENABLED': JSON.stringify(String(demoModeEnabledForBuild)),
    },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Aarogya Drishti',
        short_name: 'Aarogya',
        description: 'Care access, screening, and offline guidance for oral health screening.',
        theme_color: '#f6f7fb',
        background_color: '#f6f7fb',
        display: 'standalone',
        start_url: '/',
        id: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,avif}'],
        importScripts: ['/push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
            },
          },
          {
            urlPattern: /\/emergency\b|\/urgent\b/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'emergency-page',
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              /^\/api\/v1\/hospitals(?:\/[^/]+(?:\/doctors)?)?$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'public-discovery-cache',
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  };
});
