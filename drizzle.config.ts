import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './cloudflare-d1-worker/src/schema.ts',
  out: './cloudflare-d1-worker/migrations',
  dbCredentials: {
    wranglerConfigPath: './wrangler.jsonc',
    dbName: 'family',
  },
})
