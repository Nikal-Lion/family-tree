/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_D1_API_TOKEN?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
