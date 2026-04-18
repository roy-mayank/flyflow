import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Dev: proxy /api to FastAPI so the browser can use same-origin requests without CORS.
 * Optional override: set VITE_API_BASE_URL (e.g. http://127.0.0.1:8000) in .env.development
 * to call the API directly instead of via proxy.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
