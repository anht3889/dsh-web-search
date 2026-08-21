/**
 * Loopback HTTP routes for web-search configuration.
 * @module @anht3889/dsh-web-search-bundle/manager/http-api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { validateCatalog } from './catalog.ts'
import {
  BRAVE_API_KEY_REF,
  TAVILY_API_KEY_REF,
  type SecretRef,
} from './secrets.ts'
import type { WebSearchRuntime } from './runtime.ts'
import type { WebSearchCatalog } from './types.ts'

const MAX_JSON_BODY_BYTES = 64 * 1024
const SECRET_REFS: readonly SecretRef[] = [TAVILY_API_KEY_REF, BRAVE_API_KEY_REF]

/** Host web-server capability consumed by the manager plugin. */
export interface WebSearchWebServer {
  /**
   * Registers an owned route.
   *
   * @param route - Prefix or exact route registration.
   * @returns A disposer that unregisters the route.
   */
  register(route: {
    kind: 'prefix' | 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Registers the web-search management prefix.
 *
 * @param webServer - Host HTTP registration service.
 * @param runtime - Live web-search runtime.
 * @returns A disposer that unregisters the prefix.
 */
export function registerHttpApi(webServer: WebSearchWebServer, runtime: WebSearchRuntime): () => void {
  return webServer.register({
    kind: 'prefix',
    path: '/web-search',
    handler: async (req, res) => {
      try {
        await route(req, res, runtime)
      } catch (error: unknown) {
        respondError(res, error)
      }
    },
  })
}

async function route(req: IncomingMessage, res: ServerResponse, runtime: WebSearchRuntime): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname.slice('/web-search'.length)

  if (req.method === 'GET' && path === '/config') {
    respond(res, 200, await configView(runtime))
    return
  }
  if (req.method === 'PUT' && path === '/config') {
    const catalog = requireCatalog(await readJson(req))
    await runtime.putCatalog(catalog)
    respond(res, 200, await configView(runtime))
    return
  }
  if (req.method === 'GET' && path === '/secrets') {
    respond(res, 200, await runtime.describeSecrets())
    return
  }
  if (req.method === 'PUT' && path === '/secrets') {
    const secrets = requireSecrets(await readJson(req))
    await runtime.putSecrets(secrets)
    respond(res, 200, await runtime.describeSecrets())
    return
  }

  respond(res, 404, { error: 'not found' })
}

async function configView(runtime: WebSearchRuntime) {
  return {
    catalog: runtime.getCatalog(),
    available: runtime.provider().available(),
    secrets: await runtime.describeSecrets(),
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const contentLength = Number(req.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    req.resume()
    throw new HttpError(413, 'request body is too large')
  }

  const chunks: Buffer[] = []
  let size = 0
  let oversized = false
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_JSON_BODY_BYTES) {
      oversized = true
      chunks.length = 0
      continue
    }
    if (!oversized) chunks.push(buffer)
  }
  if (oversized) throw new HttpError(413, 'request body is too large')

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'request body must be valid JSON')
  }
}

function requireCatalog(value: unknown): WebSearchCatalog {
  try {
    validateCatalog(value)
  } catch (error: unknown) {
    throw new HttpError(400, error instanceof Error ? error.message : 'invalid catalog')
  }
  return value
}

function requireSecrets(value: unknown): Partial<Record<SecretRef, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a secret object')
  }

  const record = value as Record<string, unknown>
  for (const [key, secret] of Object.entries(record)) {
    if (!SECRET_REFS.includes(key as SecretRef)) {
      throw new HttpError(400, `unknown secret key: ${key}`)
    }
    if (typeof secret !== 'string') {
      throw new HttpError(400, `secret ${key} must be a string`)
    }
  }
  return record as Partial<Record<SecretRef, string>>
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function respondError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    respond(res, error.status, { error: error.message })
    return
  }
  const message = error instanceof Error ? error.message : 'request failed'
  respond(res, 500, { error: message })
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
