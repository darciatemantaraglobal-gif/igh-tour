import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api/frankfurter": {
        target: "https://api.frankfurter.app",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/frankfurter/, ""),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      devOptions: {
        // ⚠️ MATIKAN service worker di dev. SW caching bundle Vite yang
        // hash-nya berubah tiap HMR/restart → white-screen karena chunk lama
        // di-serve untuk module yg udah berubah export-nya. SW prod tetap
        // jalan (lihat workbox config di bawah) buat offline support.
        enabled: false,
        type: "module",
        navigateFallback: "index.html",
      },
      includeAssets: ["favicon.ico", "logo-igh-tour.png", "offline.html"],
      manifest: {
        name: "IGH Tour - Manajemen Umrah & Haji",
        short_name: "IGH Tour",
        description: "Aplikasi manajemen trip, jamaah, paket, kalkulasi biaya, dan dokumen untuk Umrah dan Haji.",
        theme_color: "#f97316",
        background_color: "#fff7ed",
        display: "standalone",
        display_override: ["fullscreen", "standalone"],
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/?source=pwa",
        lang: "id",
        dir: "ltr",
        id: "igh-tour-app",
        categories: ["travel", "business", "productivity"],
        icons: [
          {
            src: "/logo-igh-tour.png",
            sizes: "72x72",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour.png",
            sizes: "96x96",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour.png",
            sizes: "128x128",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour.png",
            sizes: "144x144",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour.png",
            sizes: "152x152",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour.png",
            sizes: "384x384",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/logo-igh-tour-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Kalkulator Biaya",
            short_name: "Kalkulator",
            description: "Hitung biaya paket Umrah & Haji",
            url: "/calculator?source=pwa",
            icons: [{ src: "/logo-igh-tour.png", sizes: "96x96" }],
          },
          {
            name: "Paket Trip",
            short_name: "Paket",
            description: "Kelola paket perjalanan",
            url: "/packages?source=pwa",
            icons: [{ src: "/logo-igh-tour.png", sizes: "96x96" }],
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}"],
        // pdf.worker chunk (~2.1 MB) dikeluarkan dari precache supaya
        // first-install PWA tidak harus download file besar ini.
        // Tetap bisa dipakai offline via runtimeCaching CacheFirst di bawah.
        globIgnores: ["**/pdf.worker*"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // pdf.worker — CacheFirst, on-demand. Hanya diambil saat user pertama
          // kali membuka fitur PDF. Setelah itu cached 30 hari (termasuk offline).
          // maxEntries: 2 cukup untuk menampung 1 versi aktif + 1 versi lama
          // yang masih mungkin diminta tab yang belum reload.
          {
            urlPattern: /\/assets\/pdf\.worker[^/]*\.(mjs|js)(\?.*)?$/,
            handler: "CacheFirst",
            options: {
              cacheName: "pdfjs-worker",
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/api\.frankfurter\.app\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "exchange-rates-cache",
              expiration: { maxEntries: 5, maxAgeSeconds: 300 },
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/unpkg\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "cdn-cache",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          // Supabase REST API — NetworkFirst so offline reads serve last cached payload
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "supabase-rest-cache",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 3 },
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Supabase Storage public/signed asset binaries
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/.*/i,
            handler: "CacheFirst",
            method: "GET",
            options: {
              cacheName: "supabase-storage-cache",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "./attached_assets"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
