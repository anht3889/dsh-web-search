import { afterEach, expect, test, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { searxngSearch } from '../../src/manager/engines/searxng.ts'
import { captureWebError } from '../support/errors.ts'
import { stubFetch } from '../support/fetch.ts'
import { abortingResponse } from '../support/responses.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('preserves the base path and maps unique results with publishedDate', async () => {
  const fetchMock = stubFetch(() => new Response(JSON.stringify({
    results: [
      {
        url: 'https://a.example',
        title: 'A',
        content: 'snip',
        publishedDate: '2026-01-01',
      },
      { title: 'missing' },
      { url: '', title: 'empty' },
      { url: 'https://a.example', title: 'dup' },
    ],
  }), { status: 200 }))

  const result = await searxngSearch(
    { query: 'two words', maxResults: 2 },
    { baseURL: 'http://127.0.0.1:8080/meta' },
  )

  expect(result).toEqual({
    sources: [
      {
        url: 'https://a.example',
        title: 'A',
        snippet: 'snip',
        publishedAt: '2026-01-01',
      },
    ],
    truncated: false,
  })
  const url = new URL(String(fetchMock.mock.calls[0]![0]))
  expect(url.toString()).toBe('http://127.0.0.1:8080/meta/search?q=two+words&format=json')
  expect([...url.searchParams.keys()]).toEqual(['q', 'format'])
})

test('discards a base query and fragment', async () => {
  const fetchMock = stubFetch(() => new Response('{"results":[]}', { status: 200 }))

  await searxngSearch({ query: 'q' }, { baseURL: 'http://127.0.0.1:8080/meta/?format=html#frag' })

  expect(String(fetchMock.mock.calls[0]![0]))
    .toBe('http://127.0.0.1:8080/meta/search?q=q&format=json')
})

test('403 tells the operator to enable JSON', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })))

  await expect(searxngSearch(
    { query: 'q' },
    { baseURL: 'http://127.0.0.1:8080' },
  )).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringContaining('format: json'),
  } satisfies Partial<WebError>)
})

test('403 keeps the JSON guidance and reports the instance detail', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ error: 'format json is disabled' }),
    { status: 403 },
  )))

  const failure = await captureWebError(searxngSearch(
    { query: 'q' },
    { baseURL: 'http://127.0.0.1:8080' },
  ))

  expect(failure.message).toContain('format: json')
  expect(failure.message).toContain('format json is disabled')
})

test('uses provider error for other non-OK responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ error: 'backend unavailable' }),
    { status: 502 },
  )))

  await expect(searxngSearch(
    { query: 'q' },
    { baseURL: 'http://127.0.0.1:8080' },
  )).rejects.toThrow('backend unavailable')
})

test('uses HTTP status when a non-OK body is not JSON', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

  await expect(searxngSearch(
    { query: 'q' },
    { baseURL: 'http://127.0.0.1:8080' },
  )).rejects.toThrow('SearXNG search API error (HTTP 500)')
})

test('maps an abort while reading the success body to WEB_ABORTED', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => abortingResponse(200, '{"results":')))

  await expect(searxngSearch(
    { query: 'q' },
    { baseURL: 'http://127.0.0.1:8080' },
  )).rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('preserves an abort while reading a non-OK body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => abortingResponse(503)))

  await expect(searxngSearch(
    { query: 'q' },
    { baseURL: 'http://127.0.0.1:8080' },
  )).rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('classifies malformed success JSON as an engine-prefixed provider error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))

  await expect(searxngSearch(
    { query: 'q' },
    { baseURL: 'http://127.0.0.1:8080' },
  )).rejects.toMatchObject({
    code: 'WEB_PROVIDER_ERROR',
    message: expect.stringMatching(/^SearXNG search returned an unprocessable response body:/),
  } satisfies Partial<WebError>)
})
