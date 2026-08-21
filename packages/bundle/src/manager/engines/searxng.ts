/**
 * SearXNG web-search adapter.
 * @module @anht3889/dsh-web-search-bundle/manager/engines/searxng
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { engineUrl, isRecord, malformedBody, providerFetch, readErrorDetail, readJsonBody } from '../http.ts'

/** Endpoint for one SearXNG search. */
export interface SearxngSearchOptions {
  /** Absolute base URL of the private SearXNG instance. */
  readonly baseURL: string
}

/** Engine-prefixed operation label used in SearXNG error messages. */
const LABEL = 'SearXNG search'

/**
 * Runs a SearXNG JSON search and normalizes its sources.
 *
 * @param request - Search query; its result limit is enforced by the provider seam.
 * @param options - SearXNG instance base URL.
 * @param signal - Optional cancellation signal.
 * @returns The untruncated provider result.
 */
export async function searxngSearch(
  request: WebSearchRequest,
  options: SearxngSearchOptions,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const url = engineUrl(options.baseURL, 'search', { q: request.query, format: 'json' })
  const response = await providerFetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  }, LABEL)

  if (!response.ok) {
    const detail = await readErrorDetail(response, LABEL)
    if (response.status === 403) {
      throw new WebError(
        'SearXNG search was forbidden; enable format: json in the instance settings'
        + (detail === undefined ? '' : ` (instance reported: ${detail})`),
        'WEB_PROVIDER_ERROR',
      )
    }
    throw new WebError(
      detail ?? `SearXNG search API error (HTTP ${response.status})`,
      'WEB_PROVIDER_ERROR',
    )
  }

  const body = await readJsonBody(response, LABEL)
  if (body.results !== undefined && !Array.isArray(body.results)) {
    throw malformedBody(LABEL, 'expected results to be an array')
  }

  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of body.results ?? []) {
    if (!isRecord(item) || typeof item.url !== 'string' || item.url.length === 0 || seen.has(item.url)) {
      continue
    }
    seen.add(item.url)
    sources.push({
      url: item.url,
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
      ...(typeof item.content === 'string' ? { snippet: item.content } : {}),
      ...(typeof item.publishedDate === 'string' ? { publishedAt: item.publishedDate } : {}),
    })
  }
  return { sources, truncated: false }
}
