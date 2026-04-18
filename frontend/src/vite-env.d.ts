/// <reference types="vite/client" />

/**
 * Optional: absolute API origin (e.g. http://127.0.0.1:8000).
 * If unset, requests use relative URLs so Vite dev proxy can forward /api.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
