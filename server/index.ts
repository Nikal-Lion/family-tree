import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { extname, resolve, sep } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import api, { initializeDatabase } from '../api/index'
import { createSqliteDatabase } from './sqliteDatabase'

const port = Number.parseInt(process.env.PORT || '3000', 10)
const host = process.env.HOST || '0.0.0.0'
const publicDirectory = resolve(process.cwd(), 'dist')
const database = createSqliteDatabase()
const environment = {
  DB: database,
  SYSADMIN_PASSWORD_PBKDF2: process.env.SYSADMIN_PASSWORD_PBKDF2,
  SYSADMIN_PASSWORD_PBKDF2_NEXT: process.env.SYSADMIN_PASSWORD_PBKDF2_NEXT,
  SESSION_TTL_HOURS: process.env.SESSION_TTL_HOURS,
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}
const hopByHopHeaders = new Set([
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function clientAddress(request: IncomingMessage): string {
  const remoteAddress = request.socket.remoteAddress ?? ''
  if (process.env.TRUST_PROXY !== 'true') return remoteAddress
  const forwarded = request.headers['x-forwarded-for']
  const firstAddress = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return firstAddress || remoteAddress
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    response.writeHead(400).end()
    return
  }
  if (decodedPath.includes('\0')) {
    response.writeHead(400).end()
    return
  }
  const filePath = resolve(publicDirectory, `.${decodedPath}`)
  if (filePath !== publicDirectory && !filePath.startsWith(`${publicDirectory}${sep}`)) {
    response.writeHead(403).end()
    return
  }

  let selectedPath = filePath
  try {
    if ((await stat(selectedPath)).isDirectory()) selectedPath = resolve(selectedPath, 'index.html')
    await stat(selectedPath)
  } catch (error) {
    if (!isMissingFile(error)) throw error
    if (extname(decodedPath)) {
      response.writeHead(404).end()
      return
    }
    selectedPath = resolve(publicDirectory, 'index.html')
  }

  const contents = await readFile(selectedPath)
  response.writeHead(200, {
    'Cache-Control': selectedPath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Length': contents.byteLength,
    'Content-Type': contentTypes[extname(selectedPath)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(contents)
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz' && incoming.method === 'GET') {
      database.check()
      outgoing.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      outgoing.end('{"ok":true}')
      return
    }

    if (!url.pathname.startsWith('/api/')) {
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        outgoing.writeHead(405, { Allow: 'GET, HEAD' }).end()
        return
      }
      await serveStatic(url.pathname, outgoing)
      return
    }

    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined && !hopByHopHeaders.has(name.toLowerCase())) {
        headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
    }
    const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD'
    const request = new Request(`http://localhost${incoming.url}`, {
      method: incoming.method,
      headers,
      ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
    })
    Object.defineProperty(request, 'clientAddress', { value: clientAddress(incoming) })
    const result = await api.fetch(request, environment)
    const responseHeaders = Object.fromEntries(result.headers.entries())
    outgoing.writeHead(result.status, responseHeaders)
    outgoing.end(Buffer.from(await result.arrayBuffer()))
  } catch (error) {
    console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error')
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    outgoing.end('{"error":"服务内部错误"}')
  }
})

server.requestTimeout = 30_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000

await initializeDatabase(database)
server.listen(port, host, () => {
  console.log(`Family Tree listening on ${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      database.close()
      process.exit(0)
    })
  })
}
