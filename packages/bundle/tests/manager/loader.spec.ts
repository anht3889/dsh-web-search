import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import { afterEach, expect, test, vi } from 'vitest'
import * as manager from '../../src/manager/index.ts'
import { WEB_SEARCH_PROVIDER_ID } from '../../src/manager/provider.ts'
import type { CredentialsApi } from '../../src/manager/secrets.ts'
import { stubFetch } from '../support/fetch.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('registers the managed provider for the plugin lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-loader-'))
  const providers = new Map<string, WebSearchProvider>()
  const ctx = new Context()
  const disposeWeb = ctx.provide('web', {
    registerSearchProvider(provider: WebSearchProvider) {
      providers.set(provider.id, provider)
      return () => providers.delete(provider.id)
    },
  })

  try {
    const fiber = await ctx.plugin(manager, {
      catalogPath: join(root, 'config.json'),
      secretsPath: join(root, 'secrets.yaml'),
    })

    expect(providers.has(WEB_SEARCH_PROVIDER_ID)).toBe(true)
    await fiber.dispose()
    expect(providers.size).toBe(0)
  } finally {
    await disposeWeb()
    await rm(root, { recursive: true, force: true })
  }
})

test('resolves keys through a credential service mounted after the manager loads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-credentials-'))
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({ engine: 'tavily', engines: {} }),
    'utf8',
  )
  const fetchMock = stubFetch(() => new Response('{"results":[]}', { status: 200 }))

  const providers = new Map<string, WebSearchProvider>()
  const ctx = new Context()
  const disposeWeb = ctx.provide('web', {
    registerSearchProvider(provider: WebSearchProvider) {
      providers.set(provider.id, provider)
      return () => providers.delete(provider.id)
    },
  })

  try {
    const fiber = await ctx.plugin(manager, {
      catalogPath: join(root, 'config.json'),
      secretsPath: join(root, 'secrets.yaml'),
    })
    const provider = providers.get(WEB_SEARCH_PROVIDER_ID)!

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('TAVILY_API_KEY'),
    })

    const credentials: CredentialsApi = {
      resolve: async () => ({ value: 'from-credentials' }),
      describe: async () => ({ configured: true }),
      set: async () => {},
      unset: async () => {},
    }
    const disposeCredentials = ctx.provide('credentials', credentials)

    await provider.search({ query: 'q' })
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('authorization'))
      .toBe('Bearer from-credentials')

    await disposeCredentials()

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('TAVILY_API_KEY'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await fiber.dispose()
  } finally {
    await disposeWeb()
    await rm(root, { recursive: true, force: true })
  }
})

test('falls back to the private secrets file when no credential service is mounted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-fallback-'))
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({ engine: 'tavily', engines: {} }),
    'utf8',
  )
  await writeFile(join(root, 'secrets.yaml'), `TAVILY_API_KEY: ${JSON.stringify('from-file')}\n`, 'utf8')
  const fetchMock = stubFetch(() => new Response('{"results":[]}', { status: 200 }))

  const providers = new Map<string, WebSearchProvider>()
  const ctx = new Context()
  const disposeWeb = ctx.provide('web', {
    registerSearchProvider(provider: WebSearchProvider) {
      providers.set(provider.id, provider)
      return () => providers.delete(provider.id)
    },
  })

  try {
    const fiber = await ctx.plugin(manager, {
      catalogPath: join(root, 'config.json'),
      secretsPath: join(root, 'secrets.yaml'),
    })

    await providers.get(WEB_SEARCH_PROVIDER_ID)!.search({ query: 'q' })

    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('authorization'))
      .toBe('Bearer from-file')
    await fiber.dispose()
  } finally {
    await disposeWeb()
    await rm(root, { recursive: true, force: true })
  }
})
