import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as manager from '../../src/manager/index.ts'
import { registerHttpApi } from '../../src/manager/http-api.ts'
import { WebSearchRuntime } from '../../src/manager/runtime.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close))
})

describe('web-search HTTP API', () => {
  test('serves live catalog state and value-free secret descriptions', async () => {
    const runtime = await createRuntime()
    const webServer = await startWebServer()
    const dispose = registerHttpApi(webServer, runtime)

    try {
      const empty = await request(webServer, '/web-search/config')
      expect(empty).toEqual({
        status: 200,
        body: {
          catalog: { engine: null, engines: {} },
          available: false,
          secrets: {
            TAVILY_API_KEY: { configured: false },
            BRAVE_API_KEY: { configured: false },
          },
        },
      })

      const catalog = {
        engine: 'searxng',
        engines: { searxng: { baseURL: 'http://127.0.0.1:8888' } },
      }
      expect(await request(webServer, '/web-search/config', 'PUT', catalog)).toMatchObject({
        status: 200,
        body: { catalog, available: true },
      })
      expect(await request(webServer, '/web-search/config')).toMatchObject({
        status: 200,
        body: { catalog, available: true },
      })

      expect(await request(webServer, '/web-search/secrets', 'PUT', { TAVILY_API_KEY: 'x' })).toEqual({
        status: 200,
        body: {
          TAVILY_API_KEY: { configured: true },
          BRAVE_API_KEY: { configured: false },
        },
      })
      expect(await request(webServer, '/web-search/secrets', 'PUT', { TAVILY_API_KEY: '' })).toMatchObject({
        status: 200,
        body: { TAVILY_API_KEY: { configured: true } },
      })
      const described = await request(webServer, '/web-search/secrets')
      expect(described).toMatchObject({
        status: 200,
        body: { TAVILY_API_KEY: { configured: true } },
      })
      expect(JSON.stringify(described.body)).not.toContain('"x"')
    } finally {
      dispose()
    }
  })

  test('rejects malformed wire payloads as client errors', async () => {
    const runtime = await createRuntime()
    const webServer = await startWebServer()
    const dispose = registerHttpApi(webServer, runtime)

    try {
      expect(await rawRequest(webServer, '/web-search/config', 'PUT', '{')).toMatchObject({
        status: 400,
        body: { error: 'request body must be valid JSON' },
      })
      expect(await request(webServer, '/web-search/config', 'PUT', { engine: 'unknown', engines: {} })).toMatchObject({
        status: 400,
        body: { error: expect.stringContaining('invalid engine') },
      })
      expect(await request(webServer, '/web-search/secrets', 'PUT', { OTHER_API_KEY: 'secret' })).toMatchObject({
        status: 400,
        body: { error: expect.stringContaining('unknown secret key') },
      })
      expect(await request(webServer, '/web-search/secrets', 'PUT', { TAVILY_API_KEY: 1 })).toMatchObject({
        status: 400,
        body: { error: expect.stringContaining('string') },
      })
      expect(await request(webServer, '/web-search/missing')).toEqual({
        status: 404,
        body: { error: 'not found' },
      })
    } finally {
      dispose()
    }
  })

  test('rejects request bodies larger than 64 KiB', async () => {
    const runtime = await createRuntime()
    const webServer = await startWebServer()
    const dispose = registerHttpApi(webServer, runtime)

    try {
      const result = await rawRequest(
        webServer,
        '/web-search/secrets',
        'PUT',
        JSON.stringify({ TAVILY_API_KEY: 'x'.repeat(65_536) }),
      )
      expect(result).toEqual({ status: 413, body: { error: 'request body is too large' } })
    } finally {
      dispose()
    }
  })

  test('rejects an oversized chunked body that declares no content-length', async () => {
    const runtime = await createRuntime()
    const webServer = await startWebServer()
    const dispose = registerHttpApi(webServer, runtime)

    try {
      const chunk = 'x'.repeat(1024)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode('{"TAVILY_API_KEY":"'))
          for (let sent = 0; sent < 80; sent += 1) controller.enqueue(encoder.encode(chunk))
          controller.enqueue(encoder.encode('"}'))
          controller.close()
        },
      })
      const response = await fetch(`${webServer.origin}/web-search/secrets`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })

      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ error: 'request body is too large' })
      expect(await request(webServer, '/web-search/secrets')).toMatchObject({
        status: 200,
        body: { TAVILY_API_KEY: { configured: false } },
      })
    } finally {
      dispose()
    }
  })

  test('writes secrets through mounted credentials without exposing values', async () => {
    const values = new Map<string, string>()
    const runtime = await createRuntime({
      credentials: () => ({
        resolve: async ref => values.has(ref) ? { value: values.get(ref)! } : undefined,
        describe: async ref => ({ configured: values.has(ref) }),
        set: async (ref, value) => { values.set(ref, value) },
        unset: async ref => { values.delete(ref) },
      }),
    })
    const webServer = await startWebServer()
    const dispose = registerHttpApi(webServer, runtime)

    try {
      const response = await request(webServer, '/web-search/secrets', 'PUT', { BRAVE_API_KEY: 'credential-value' })
      expect(values.get('BRAVE_API_KEY')).toBe('credential-value')
      expect(response).toEqual({
        status: 200,
        body: {
          TAVILY_API_KEY: { configured: false },
          BRAVE_API_KEY: { configured: true },
        },
      })
      expect(JSON.stringify((await request(webServer, '/web-search/config')).body)).not.toContain('credential-value')
    } finally {
      dispose()
    }
  })
})

describe('WebSearchRuntime', () => {
  test('keeps one provider instance backed by the current catalog', async () => {
    const runtime = await createRuntime()
    const provider = runtime.provider()

    expect(provider.available()).toBe(false)
    await runtime.putCatalog({
      engine: 'searxng',
      engines: { searxng: { baseURL: 'http://127.0.0.1:8888' } },
    })

    expect(runtime.provider()).toBe(provider)
    expect(provider.available()).toBe(true)
  })

  test('publishes a catalog only after its durable save succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-runtime-'))
    const catalogPath = join(root, 'config.json')
    const runtime = await WebSearchRuntime.create({
      catalogPath,
      secretsPath: join(root, 'secrets.yaml'),
      env: () => ({}),
    })
    const lastGood = {
      engine: 'searxng' as const,
      engines: { searxng: { baseURL: 'http://127.0.0.1:8888' } },
    }
    await runtime.putCatalog(lastGood)
    await rm(catalogPath)
    await mkdir(catalogPath)

    await expect(runtime.putCatalog({ engine: 'tavily', engines: {} })).rejects.toThrow()
    expect(runtime.getCatalog()).toEqual(lastGood)
    expect(runtime.provider().available()).toBe(true)
  })

  test('serializes catalog persistence in invocation order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-runtime-'))
    const firstSave = Promise.withResolvers<void>()
    const persisted: Array<'first' | 'second'> = []
    const first = {
      engine: 'searxng' as const,
      engines: { searxng: { baseURL: 'http://127.0.0.1:8001' } },
    }
    const second = {
      engine: 'searxng' as const,
      engines: { searxng: { baseURL: 'http://127.0.0.1:8002' } },
    }
    const runtime = await WebSearchRuntime.create({
      catalogPath: join(root, 'config.json'),
      secretsPath: join(root, 'secrets.yaml'),
      env: () => ({}),
      persistCatalogForTest: async (_path, catalog) => {
        const call = catalog === first ? 'first' : 'second'
        persisted.push(call)
        if (call === 'first') await firstSave.promise
      },
    })

    const firstPut = runtime.putCatalog(first)
    await Promise.resolve()
    const secondPut = runtime.putCatalog(second)
    await Promise.resolve()

    expect(persisted).toEqual(['first'])
    expect(runtime.getCatalog()).toEqual({ engine: null, engines: {} })

    firstSave.resolve()
    await Promise.all([firstPut, secondPut])
    expect(persisted).toEqual(['first', 'second'])
    expect(runtime.getCatalog()).toBe(second)
  })

  test('continues queued catalog writes after a save rejects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-runtime-'))
    const firstSave = Promise.withResolvers<void>()
    const persisted: Array<'failed' | 'recovery'> = []
    const failed = { engine: 'tavily' as const, engines: {} }
    const recovery = { engine: 'brave' as const, engines: {} }
    const runtime = await WebSearchRuntime.create({
      catalogPath: join(root, 'config.json'),
      secretsPath: join(root, 'secrets.yaml'),
      env: () => ({}),
      persistCatalogForTest: async (_path, catalog) => {
        const call = catalog === failed ? 'failed' : 'recovery'
        persisted.push(call)
        if (call === 'failed') await firstSave.promise
      },
    })

    const failedPut = runtime.putCatalog(failed)
    await Promise.resolve()
    const recoveryPut = runtime.putCatalog(recovery)
    await Promise.resolve()

    expect(persisted).toEqual(['failed'])
    firstSave.reject(new Error('save failed'))
    await expect(failedPut).rejects.toThrow('save failed')
    await expect(recoveryPut).resolves.toBe(recovery)
    expect(persisted).toEqual(['failed', 'recovery'])
    expect(runtime.getCatalog()).toBe(recovery)
  })
})

describe('manager plugin', () => {
  test('registers and disposes the provider without a web server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-plugin-'))
    const disposeProvider = vi.fn()
    const registerSearchProvider = vi.fn(() => disposeProvider)
    const ctx = new Context()
    const disposeWeb = ctx.provide('web', { registerSearchProvider })
    const fiber = await ctx.plugin(manager, {
      catalogPath: join(root, 'config.json'),
      secretsPath: join(root, 'secrets.yaml'),
    })

    expect(registerSearchProvider).toHaveBeenCalledOnce()
    await fiber.dispose()
    expect(disposeProvider).toHaveBeenCalledOnce()
    await disposeWeb()
  })

  test('mounts and disposes HTTP routes when webServer appears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-plugin-'))
    const ctx = new Context()
    const disposeWeb = ctx.provide('web', { registerSearchProvider: () => () => {} })
    const fiber = await ctx.plugin(manager, {
      catalogPath: join(root, 'config.json'),
      secretsPath: join(root, 'secrets.yaml'),
    })
    const register = vi.fn(() => vi.fn())
    const disposeWebServer = ctx.provide('webServer', { register })

    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: '/web-search' }))
    })
    const routeDisposer = register.mock.results[0]!.value
    await disposeWebServer()
    await vi.waitFor(() => {
      expect(routeDisposer).toHaveBeenCalledOnce()
    })

    await fiber.dispose()
    await disposeWeb()
  })
})

interface TestWebServer {
  origin: string
  register(route: {
    kind: 'prefix' | 'exact'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

async function createRuntime(overrides: Partial<Parameters<typeof WebSearchRuntime.create>[0]> = {}): Promise<WebSearchRuntime> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-http-'))
  return await WebSearchRuntime.create({
    catalogPath: join(root, 'config.json'),
    secretsPath: join(root, 'secrets.yaml'),
    env: () => ({}),
    ...overrides,
  })
}

type RouteHandler = Parameters<TestWebServer['register']>[0]['handler']

async function startWebServer(): Promise<TestWebServer> {
  let routeHandler: RouteHandler | undefined
  const server = createServer((request, response) => {
    if (routeHandler === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void routeHandler(request, response)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${address.port}`,
    register(route) {
      expect(route).toMatchObject({ kind: 'prefix', path: '/web-search' })
      routeHandler = route.handler
      return () => { routeHandler = undefined }
    },
  }
}

async function request(
  webServer: Pick<TestWebServer, 'origin'>,
  pathname: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return await rawRequest(
    webServer,
    pathname,
    method,
    body === undefined ? undefined : JSON.stringify(body),
  )
}

async function rawRequest(
  webServer: Pick<TestWebServer, 'origin'>,
  pathname: string,
  method: string,
  body?: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${webServer.origin}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body,
  })
  return { status: response.status, body: await response.json() }
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}
