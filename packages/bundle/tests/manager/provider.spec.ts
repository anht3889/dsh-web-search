import { afterEach, expect, test, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  MultiEngineSearchProvider,
  WEB_SEARCH_PROVIDER_ID,
  resolvedBaseURL,
} from '../../src/manager/provider.ts'
import { BRAVE_API_KEY_REF, TAVILY_API_KEY_REF } from '../../src/manager/secrets.ts'
import {
  BRAVE_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_BASE_URL,
} from '../../src/manager/types.ts'
import { stubFetch } from '../support/fetch.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('provider id is dsh-web-search', () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: null, engines: {} }),
    resolveKey: async () => 'k',
  })
  expect(provider.id).toBe(WEB_SEARCH_PROVIDER_ID)
})

test('unavailable when engine is null', () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: null, engines: {} }),
    resolveKey: async () => 'k',
  })
  expect(provider.available()).toBe(false)
})

test('available for Tavily with default base URL and no key check', () => {
  const resolveKey = vi.fn(async () => undefined)
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'tavily', engines: {} }),
    resolveKey,
  })
  expect(provider.available()).toBe(true)
  expect(resolveKey).not.toHaveBeenCalled()
})

test('available for Brave with default base URL', () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'brave', engines: {} }),
    resolveKey: async () => undefined,
  })
  expect(provider.available()).toBe(true)
})

test('unavailable for SearXNG when catalog URL is missing', () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'searxng', engines: {} }),
    resolveKey: async () => undefined,
  })
  expect(provider.available()).toBe(false)
})

test('unavailable when catalog base URL is invalid', () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({
      engine: 'tavily',
      engines: { tavily: { baseURL: 'not-a-url' } },
    }),
    resolveKey: async () => 'k',
  })
  expect(provider.available()).toBe(false)
})

test('available for SearXNG when catalog URL parses', () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({
      engine: 'searxng',
      engines: { searxng: { baseURL: 'http://127.0.0.1:8080' } },
    }),
    resolveKey: async () => undefined,
  })
  expect(provider.available()).toBe(true)
})

test('search rejects when engine is not configured', async () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: null, engines: {} }),
    resolveKey: async () => 'k',
  })
  await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: 'web-search engine is not configured',
  } satisfies Partial<WebError>)
})

test('missing Tavily key fails search not available()', async () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'tavily', engines: {} }),
    resolveKey: async () => undefined,
  })
  expect(provider.available()).toBe(true)
  await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringMatching(/tavily search credential is missing; set TAVILY_API_KEY/),
  } satisfies Partial<WebError>)
})

test('missing Brave key fails search with exact ref', async () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'brave', engines: {} }),
    resolveKey: async () => undefined,
  })
  expect(provider.available()).toBe(true)
  await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: `brave search credential is missing; set ${BRAVE_API_KEY_REF} in Settings or the environment`,
  } satisfies Partial<WebError>)
})

test('dispatches Tavily search', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    answer: 'a',
    results: [{ url: 'https://t.example', title: 'T' }],
  }), { status: 200 })))

  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'tavily', engines: {} }),
    resolveKey: async (ref) => (ref === TAVILY_API_KEY_REF ? 'k' : undefined),
  })

  const result = await provider.search({ query: 'q' })
  expect(result.sources[0]?.url).toBe('https://t.example')
  expect(result.content).toBe('a')
})

test('dispatches Brave search', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    web: { results: [{ url: 'https://b.example', title: 'B' }] },
  }), { status: 200 })))

  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'brave', engines: {} }),
    resolveKey: async (ref) => (ref === BRAVE_API_KEY_REF ? 'k' : undefined),
  })

  const result = await provider.search({ query: 'q' })
  expect(result.sources[0]?.url).toBe('https://b.example')
})

test('dispatches SearXNG search', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    results: [{ url: 'https://s.example', title: 'S' }],
  }), { status: 200 })))

  const provider = new MultiEngineSearchProvider({
    catalog: () => ({
      engine: 'searxng',
      engines: { searxng: { baseURL: 'http://127.0.0.1:8080' } },
    }),
    resolveKey: async () => undefined,
  })

  const result = await provider.search({ query: 'q' })
  expect(result.sources[0]?.url).toBe('https://s.example')
})

test('next search uses the catalog at call time', async () => {
  let engine: 'tavily' | 'brave' = 'tavily'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('tavily')) {
      return new Response(JSON.stringify({ results: [{ url: 'https://t.example' }] }), { status: 200 })
    }
    return new Response(JSON.stringify({ web: { results: [{ url: 'https://b.example' }] } }), { status: 200 })
  }))
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine, engines: {} }),
    resolveKey: async () => 'k',
  })
  expect((await provider.search({ query: 'q' })).sources[0]?.url).toBe('https://t.example')
  engine = 'brave'
  expect((await provider.search({ query: 'q' })).sources[0]?.url).toBe('https://b.example')
})

test('uses catalog base URL override for Tavily', async () => {
  const fetchMock = stubFetch(() => new Response(JSON.stringify({ results: [] }), { status: 200 }))

  const provider = new MultiEngineSearchProvider({
    catalog: () => ({
      engine: 'tavily',
      engines: { tavily: { baseURL: 'https://custom.tavily.test/' } },
    }),
    resolveKey: async () => 'k',
  })

  await provider.search({ query: 'q' })
  expect(String(fetchMock.mock.calls[0]![0])).toBe('https://custom.tavily.test/search')
})

test('uses catalog base URL override for Brave', async () => {
  const fetchMock = stubFetch(() => new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }))

  const provider = new MultiEngineSearchProvider({
    catalog: () => ({
      engine: 'brave',
      engines: { brave: { baseURL: 'https://custom.brave.test' } },
    }),
    resolveKey: async () => 'k',
  })

  await provider.search({ query: 'q' })
  expect(String(fetchMock.mock.calls[0]![0])).toMatch(/^https:\/\/custom\.brave\.test\/res\/v1\/web\/search/)
})

test('forwards abort signal to engine adapter', async () => {
  const controller = new AbortController()
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBe(controller.signal)
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)

  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'tavily', engines: {} }),
    resolveKey: async () => 'k',
  })

  await provider.search({ query: 'q' }, controller.signal)
})

test('resolvedBaseURL applies defaults and overrides', () => {
  expect(resolvedBaseURL({ engine: 'tavily', engines: {} }, 'tavily')).toBe(TAVILY_DEFAULT_BASE_URL)
  expect(resolvedBaseURL({ engine: 'brave', engines: {} }, 'brave')).toBe(BRAVE_DEFAULT_BASE_URL)
  expect(resolvedBaseURL({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://override.test' } },
  }, 'tavily')).toBe('https://override.test')
  expect(resolvedBaseURL({
    engine: 'searxng',
    engines: { searxng: { baseURL: 'http://127.0.0.1:8080' } },
  }, 'searxng')).toBe('http://127.0.0.1:8080')
  expect(resolvedBaseURL({ engine: 'searxng', engines: {} }, 'searxng')).toBe('')
})
