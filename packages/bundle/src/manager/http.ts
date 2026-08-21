/**
 * Shared HTTP transport, URL construction, and bounded response reading for
 * web-search engine adapters.
 * @module @anht3889/dsh-web-search-bundle/manager/http
 */

import { WebError } from '@deepseek-ai/dsh-web'

/**
 * Fixed upper bound on the bytes read from one provider response body. A
 * hostile or broken SearXNG instance or search API cannot make the Host buffer
 * more than this before the read fails. The value is a security invariant, not
 * a deployment tunable: search responses are JSON result lists whose largest
 * observed size is orders of magnitude below it.
 */
export const MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024

/** Fixed upper bound on upstream text copied into a {@link WebError} message. */
export const MAX_ERROR_DETAIL_CHARS = 500

/** Keys searched, in order, for a human-readable upstream error message. */
const ERROR_DETAIL_KEYS = ['detail', 'error', 'message'] as const

/**
 * Reports whether an error is a fetch or `AbortSignal` cancellation.
 *
 * @param error - The thrown error to classify.
 * @returns Whether the error is an abort, surfaced as `WEB_ABORTED`.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Builds an engine request URL with URL semantics: the base URL's path is a
 * prefix, and its query and fragment are discarded so a configured base cannot
 * inject or overwrite request parameters.
 *
 * @param baseURL - Absolute engine base URL from the catalog or its default.
 * @param path - Engine endpoint path appended to the base path.
 * @param params - Query parameters set on the resulting URL.
 * @returns The request URL.
 */
export function engineUrl(
  baseURL: string,
  path: string,
  params: Record<string, string> = {},
): URL {
  const url = new URL(baseURL)
  url.search = ''
  url.hash = ''
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url
}

/**
 * Performs a provider HTTP request with redirects rejected before follow.
 *
 * @param url - Request URL.
 * @param init - Fetch init; `redirect` is always forced to `'error'`.
 * @param label - Engine-prefixed operation label used in error messages.
 * @returns The fetch response when the request completes without error.
 */
export async function providerFetch(
  url: string | URL,
  init: RequestInit,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: 'error' })
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw abortedError(label, error)
    }
    throw new WebError(`${label} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Byte-cap override for transport tests. */
export interface ResponseReadOptions {
  /**
   * @internal Byte cap used instead of {@link MAX_RESPONSE_BODY_BYTES} so
   * transport tests can exercise the oversized path without large fixtures.
   */
  maxBodyBytes?: number
}

/**
 * Reads a successful provider response as a bounded JSON object.
 *
 * @param response - The provider response whose body has not been read.
 * @param label - Engine-prefixed operation label used in error messages.
 * @param options - Byte-cap override for transport tests.
 * @returns The parsed JSON object.
 * @throws `WEB_ABORTED` when the read is cancelled, or an engine-prefixed
 * `WEB_PROVIDER_ERROR` when the body is oversized, unreadable, or not a JSON object.
 */
export async function readJsonBody(
  response: Response,
  label: string,
  options: ResponseReadOptions = {},
): Promise<Record<string, unknown>> {
  const text = await readBoundedText(response, label, options.maxBodyBytes ?? MAX_RESPONSE_BODY_BYTES)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw malformedBody(label, String(error), error)
  }
  if (!isRecord(body)) {
    throw malformedBody(label, 'expected a JSON object')
  }
  return body
}

/**
 * Reads a bounded, truncated upstream message from a failed provider response.
 * An oversized or unparseable failure body yields no detail, leaving the caller
 * to report the HTTP status.
 *
 * @param response - The failed provider response whose body has not been read.
 * @param label - Engine-prefixed operation label used in error messages.
 * @param options - Byte-cap override for transport tests.
 * @returns The truncated upstream message, or `undefined` when none is usable.
 * @throws `WEB_ABORTED` when the read is cancelled.
 */
export async function readErrorDetail(
  response: Response,
  label: string,
  options: ResponseReadOptions = {},
): Promise<string | undefined> {
  let body: unknown
  try {
    body = JSON.parse(await readBoundedText(response, label, options.maxBodyBytes ?? MAX_RESPONSE_BODY_BYTES))
  } catch (error: unknown) {
    if (error instanceof WebError && error.code === 'WEB_ABORTED') throw error
    return undefined
  }
  if (!isRecord(body)) return undefined
  for (const key of ERROR_DETAIL_KEYS) {
    const value = body[key]
    if (typeof value === 'string' && value.length > 0) return truncateDetail(value)
  }
  return undefined
}

/**
 * Builds the engine-prefixed error for a response body that cannot be used.
 *
 * @param label - Engine-prefixed operation label.
 * @param detail - Reason the body is unusable; truncated before it is shown.
 * @param cause - Underlying error, when one exists.
 * @returns The `WEB_PROVIDER_ERROR` to throw.
 */
export function malformedBody(label: string, detail: string, cause?: unknown): WebError {
  return new WebError(
    `${label} returned an unprocessable response body: ${truncateDetail(detail)}`,
    'WEB_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Reports whether a value is a non-array JSON object.
 *
 * @param value - The parsed JSON value to classify.
 * @returns Whether the value is a JSON object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Streams a response body, failing once it passes the byte cap. */
async function readBoundedText(response: Response, label: string, maxBodyBytes: number): Promise<string> {
  const body = response.body
  if (body === null) return ''

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done === true) break
      size += value.byteLength
      if (size > maxBodyBytes) {
        await reader.cancel()
        throw malformedBody(label, `response body exceeded ${maxBodyBytes} bytes`)
      }
      chunks.push(value)
    }
  } catch (error: unknown) {
    if (error instanceof WebError) throw error
    if (isAbortError(error)) throw abortedError(label, error)
    throw malformedBody(label, String(error), error)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Builds the cancellation error shared by transport and body reads. */
function abortedError(label: string, cause: unknown): WebError {
  return new WebError(`${label} aborted`, 'WEB_ABORTED', { cause })
}

/** Bounds upstream-controlled text before it reaches an error message. */
function truncateDetail(detail: string): string {
  return detail.length <= MAX_ERROR_DETAIL_CHARS
    ? detail
    : `${detail.slice(0, MAX_ERROR_DETAIL_CHARS)} (truncated)`
}
