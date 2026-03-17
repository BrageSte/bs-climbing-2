/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PREVIEW_MODEL_API_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
