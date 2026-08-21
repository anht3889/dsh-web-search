import { afterEach, expect, test, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { tavilySearch } from '../../src/manager/engines/tavily.ts'
import { captureWebError } from '../support/errors.ts'
import { stubFetch } from '../support/fetch.ts'
import { abortingResponse } from '../support/responses.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('maps answer and unique results while dropping empty URLs', async () => {
  const fetchMock = stubFetch(() => new Response(JSON.stringify({
    answer: 'summary',
    results: [
      { url: 'https://a.example', title: 'A', content: 'snip', published_date: '2026-01-01' },
      { title: 'no url' },
      { url: '', title: 'empty url' },
      { url: 'https://a.example', title: 'dup' },
    ],
  }), { status: 200 }))

  const result = await tavilySearch(
    { query: 'q', maxResults: 3 },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  )

  expect(result).toEqual({
    content: 'summary',
    sources: [
      { url: 'https://a.example', title: 'A', snippet: 'snip', publishedAt: '2026-01-01' },
    ],
    truncated: false,
  })
  const [url, init] = fetchMock.mock.calls[0]!
  expect(String(url)).toBe('https://api.tavily.com/search')
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer k')
  expect(JSON.parse(String(init.body))).toEqual({
    query: 'q',
    include_answer: true,
    max_results: 3,
  })
})

test('omits max_results when maxResults is absent', async () => {
  const fetchMock = stubFetch(() => new Response('{"results":[]}', { status: 200 }))

  await tavilySearch({ query: 'q' }, { baseURL: 'https://api.tavily.com/', apiKey: 'k' })

  const [, init] = fetchMock.mock.calls[0]!
  expect(JSON.parse(String(init.body))).toEqual({ query: 'q', include_answer: true })
})

test('keeps a base path prefix and discards base query and fragment', async () => {
  const fetchMock = stubFetch(() => new Response('{"results":[]}', { status: 200 }))

  await tavilySearch(
    { query: 'q' },
    { baseURL: 'https://proxy.example/tavily/v1/?tenant=a#frag', apiKey: 'k' },
  )

  expect(String(fetchMock.mock.calls[0]![0])).toBe('https://proxy.example/tavily/v1/search')
})

test('uses provider detail for non-OK responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ detail: 'invalid API key' }),
    { status: 401 },
  )))

  await expect(tavilySearch(
    { query: 'q' },
    { baseURL: 'https://api.tavily.com', apiKey: 'bad' },
  )).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringContaining('invalid API key'),
  } satisfies Partial<WebError>)
})

test('truncates a hostile provider detail', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ detail: 'x'.repeat(4000) }),
    { status: 400 },
  )))

  const failure = await captureWebError(tavilySearch(
    { query: 'q' },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  ))

  expect(failure.code).toBe('WEB_PROVIDER_ERROR')
  expect(failure.message.endsWith('(truncated)')).toBe(true)
  expect(failure.message.length).toBeLessThan(600)
})

test('uses HTTP status when a non-OK body is not JSON', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

  await expect(tavilySearch(
    { query: 'q' },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  )).rejects.toThrow('Tavily API error (HTTP 500)')
})

test('maps an abort while reading the success body to WEB_ABORTED', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => abortingResponse(200, '{"results":')))

  await expect(tavilySearch(
    { query: 'q' },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  )).rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('preserves an abort while reading a non-OK body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => abortingResponse(503)))

  await expect(tavilySearch(
    { query: 'q' },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  )).rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('classifies malformed success JSON as an engine-prefixed provider error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))

  await expect(tavilySearch(
    { query: 'q' },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  )).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringMatching(/^Tavily search returned an unprocessable response body:/),
  } satisfies Partial<WebError>)
})

test('classifies a malformed results field as an engine-prefixed provider error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"results":{}}', { status: 200 })))

  await expect(tavilySearch(
    { query: 'q' },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  )).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringMatching(/^Tavily search returned an unprocessable response body:/),
  } satisfies Partial<WebError>)
})
