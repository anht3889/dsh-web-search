import { afterEach, expect, test, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { braveSearch } from '../../src/manager/engines/brave.ts'
import { stubFetch } from '../support/fetch.ts'
import { abortingResponse } from '../support/responses.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('maps unique web results and drops empty URLs', async () => {
  const fetchMock = stubFetch(() => new Response(JSON.stringify({
    web: {
      results: [
        { url: 'https://a.example', title: 'A', description: 'snip' },
        { title: 'missing' },
        { url: '', title: 'empty' },
        { url: 'https://a.example', title: 'dup' },
      ],
    },
  }), { status: 200 }))

  const result = await braveSearch(
    { query: 'two words', maxResults: 50 },
    { baseURL: 'https://api.search.brave.com', apiKey: 'token' },
  )

  expect(result).toEqual({
    sources: [{ url: 'https://a.example', title: 'A', snippet: 'snip' }],
    truncated: false,
  })
  const [url, init] = fetchMock.mock.calls[0]!
  expect(String(url)).toBe('https://api.search.brave.com/res/v1/web/search?q=two+words&count=20')
  expect(new Headers(init.headers).get('x-subscription-token')).toBe('token')
})

test('uses count 10 and empty sources when web results are absent', async () => {
  const fetchMock = stubFetch(() => new Response('{}', { status: 200 }))

  const result = await braveSearch(
    { query: 'q' },
    { baseURL: 'https://api.search.brave.com/', apiKey: 'token' },
  )

  expect(result.sources).toEqual([])
  expect(String(fetchMock.mock.calls[0]![0])).toBe(
    'https://api.search.brave.com/res/v1/web/search?q=q&count=10',
  )
})

test.each([0, -5])('clamps a non-positive maxResults of %i to one result', async (maxResults) => {
  const fetchMock = stubFetch(() => new Response('{}', { status: 200 }))

  await braveSearch(
    { query: 'q', maxResults },
    { baseURL: 'https://api.search.brave.com', apiKey: 'token' },
  )

  expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('count')).toBe('1')
})

test('keeps a base path prefix and discards base query and fragment', async () => {
  const fetchMock = stubFetch(() => new Response('{}', { status: 200 }))

  await braveSearch(
    { query: 'q' },
    { baseURL: 'https://proxy.example/brave?tenant=a#frag', apiKey: 'token' },
  )

  const url = new URL(String(fetchMock.mock.calls[0]![0]))
  expect(url.pathname).toBe('/brave/res/v1/web/search')
  expect([...url.searchParams.keys()]).toEqual(['q', 'count'])
  expect(url.hash).toBe('')
})

test('uses provider message for non-OK responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ message: 'subscription rejected' }),
    { status: 401 },
  )))

  await expect(braveSearch(
    { query: 'q' },
    { baseURL: 'https://api.search.brave.com', apiKey: 'bad' },
  )).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringContaining('subscription rejected'),
  } satisfies Partial<WebError>)
})

test('uses HTTP status when a non-OK body is not JSON', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

  await expect(braveSearch(
    { query: 'q' },
    { baseURL: 'https://api.search.brave.com', apiKey: 'token' },
  )).rejects.toThrow('Brave search API error (HTTP 500)')
})

test('maps an abort while reading the success body to WEB_ABORTED', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => abortingResponse(200, '{"web":')))

  await expect(braveSearch(
    { query: 'q' },
    { baseURL: 'https://api.search.brave.com', apiKey: 'token' },
  )).rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('preserves an abort while reading a non-OK body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => abortingResponse(503)))

  await expect(braveSearch(
    { query: 'q' },
    { baseURL: 'https://api.search.brave.com', apiKey: 'token' },
  )).rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('classifies malformed success JSON as an engine-prefixed provider error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))

  await expect(braveSearch(
    { query: 'q' },
    { baseURL: 'https://api.search.brave.com', apiKey: 'token' },
  )).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringMatching(/^Brave search returned an unprocessable response body:/),
  } satisfies Partial<WebError>)
})
