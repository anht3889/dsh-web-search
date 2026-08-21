import { afterEach, expect, test, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  MAX_ERROR_DETAIL_CHARS,
  MAX_RESPONSE_BODY_BYTES,
  engineUrl,
  providerFetch,
  readErrorDetail,
  readJsonBody,
} from '../../src/manager/http.ts'
import { abortingResponse, chunkedResponse } from '../support/responses.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('passes redirect: error to fetch', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await providerFetch('https://example.test/search', { method: 'GET' }, 'Tavily search')
  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.test/search',
    expect.objectContaining({ redirect: 'error' }),
  )
})

test('forces redirect: error over caller init', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await providerFetch('https://example.test/search', { redirect: 'follow' }, 'Tavily search')
  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.test/search',
    expect.objectContaining({ redirect: 'error' }),
  )
})

test('maps AbortError to WEB_ABORTED', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new DOMException('aborted', 'AbortError')
  }))
  await expect(providerFetch('https://example.test', {}, 'Brave search'))
    .rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('maps other fetch failures to WEB_PROVIDER_ERROR', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('fetch failed')
  }))
  await expect(providerFetch('https://example.test', {}, 'Brave search'))
    .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' } satisfies Partial<WebError>)
})

test('does not classify arbitrary errors as aborts', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('aborted')
  }))
  await expect(providerFetch('https://example.test', {}, 'Brave search'))
    .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' } satisfies Partial<WebError>)
})

test('appends the endpoint path to a base path and drops base query and fragment', () => {
  expect(engineUrl('https://host.test', 'search').toString())
    .toBe('https://host.test/search')
  expect(engineUrl('https://host.test/v1/', 'search').toString())
    .toBe('https://host.test/v1/search')
  expect(engineUrl('https://host.test/v1?tenant=a#frag', 'res/v1/web/search', { q: 'x y' }).toString())
    .toBe('https://host.test/v1/res/v1/web/search?q=x+y')
})

test('reads a chunked JSON body across stream chunks', async () => {
  const body = await readJsonBody(chunkedResponse(['{"a"', ':1}']), 'Tavily search')
  expect(body).toEqual({ a: 1 })
})

test('rejects a body over the byte cap as an engine-prefixed provider error', async () => {
  await expect(readJsonBody(chunkedResponse(['{"a":1}', 'xxxx']), 'SearXNG search', { maxBodyBytes: 8 }))
    .rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringMatching(/^SearXNG search returned an unprocessable response body: response body exceeded 8 bytes$/),
    } satisfies Partial<WebError>)
})

test('rejects a non-object JSON body', async () => {
  await expect(readJsonBody(new Response('[]', { status: 200 }), 'Brave search'))
    .rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Brave search returned an unprocessable response body: expected a JSON object',
    } satisfies Partial<WebError>)
})

test('maps an abort during body streaming to WEB_ABORTED', async () => {
  await expect(readJsonBody(abortingResponse(200, '{"a"'), 'Tavily search'))
    .rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('reads no detail from an empty error body', async () => {
  expect(await readErrorDetail(new Response(null, { status: 500 }), 'Brave search')).toBeUndefined()
})

test('reads no detail from an oversized error body instead of buffering it', async () => {
  expect(await readErrorDetail(
    chunkedResponse(['{"error":"', 'x'.repeat(64), '"}'], 500),
    'SearXNG search',
    { maxBodyBytes: 16 },
  )).toBeUndefined()
})

test('truncates an oversized error detail', async () => {
  const detail = await readErrorDetail(
    new Response(JSON.stringify({ error: 'y'.repeat(MAX_ERROR_DETAIL_CHARS + 50) }), { status: 400 }),
    'Tavily search',
  )
  expect(detail).toBe(`${'y'.repeat(MAX_ERROR_DETAIL_CHARS)} (truncated)`)
})

test('rethrows an abort while reading an error body', async () => {
  await expect(readErrorDetail(abortingResponse(503), 'Brave search'))
    .rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})

test('caps provider response bodies at two mebibytes', () => {
  expect(MAX_RESPONSE_BODY_BYTES).toBe(2 * 1024 * 1024)
})
