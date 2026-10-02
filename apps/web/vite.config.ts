import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      injectRegister: "auto",
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png", "boi.webp"],
      manifest: {
        background_color: "#0f1114",
        display: "standalone",
        icons: [
          {
            sizes: "192x192",
            src: "/app-icons/pwa-192x192.png",
            type: "image/png",
          },
          {
            sizes: "512x512",
            src: "/app-icons/pwa-512x512.png",
            type: "image/png",
          },
          {
            purpose: "maskable",
            sizes: "192x192",
            src: "/app-icons/maskable-192x192.png",
            type: "image/png",
          },
          {
            purpose: "maskable",
            sizes: "512x512",
            src: "/app-icons/maskable-512x512.png",
            type: "image/png",
          },
        ],
        name: "RSS Boi",
        scope: "/",
        short_name: "RSS Boi",
        start_url: "/",
        theme_color: "#0f1114",
      },
      workbox: {
        globPatterns: ["**/*.{css,html,ico,png,svg,js}", "**/literata-latin*.woff2"],
        globIgnores: ["**/config.js"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            handler: "NetworkFirst",
            options: {
              cacheName: "runtime-config",
            },
            urlPattern: /\/config\.js$/,
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  preview: {
    allowedHosts: true,
    host: "0.0.0.0",
    port: 3000,
  },
});
