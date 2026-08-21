/**
 * Brave web-search adapter.
 * @module @anht3889/dsh-web-search-bundle/manager/engines/brave
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { engineUrl, isRecord, malformedBody, providerFetch, readErrorDetail, readJsonBody } from '../http.ts'

/** Endpoint and credential for one Brave search. */
export interface BraveSearchOptions {
  /** Absolute Brave Search API base URL. */
  readonly baseURL: string
  /** Brave subscription token. */
  readonly apiKey: string
}

/** Engine-prefixed operation label used in Brave error messages. */
const LABEL = 'Brave search'

/** Result count used when the request sets no limit. */
const DEFAULT_COUNT = 10

/** Inclusive `count` range the Brave Search API accepts. */
const MIN_COUNT = 1
const MAX_COUNT = 20

/**
 * Runs a Brave web search and normalizes its sources.
 *
 * @param request - Search query and optional provider result limit.
 * @param options - Brave endpoint and subscription token.
 * @param signal - Optional cancellation signal.
 * @returns The untruncated provider result.
 */
export async function braveSearch(
  request: WebSearchRequest,
  options: BraveSearchOptions,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const count = Math.min(Math.max(request.maxResults ?? DEFAULT_COUNT, MIN_COUNT), MAX_COUNT)
  const url = engineUrl(options.baseURL, 'res/v1/web/search', {
    q: request.query,
    count: String(count),
  })
  const response = await providerFetch(url, {
    method: 'GET',
    headers: {
      'X-Subscription-Token': options.apiKey,
      accept: 'application/json',
    },
    signal,
  }, LABEL)

  if (!response.ok) {
    const detail = await readErrorDetail(response, LABEL)
    throw new WebError(
      detail ?? `Brave search API error (HTTP ${response.status})`,
      'WEB_PROVIDER_ERROR',
    )
  }

  const body = await readJsonBody(response, LABEL)
  const web = body.web
  if (web !== undefined && !isRecord(web)) {
    throw malformedBody(LABEL, 'expected web to be a JSON object')
  }
  const results = web?.results
  if (results !== undefined && !Array.isArray(results)) {
    throw malformedBody(LABEL, 'expected web.results to be an array')
  }

  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of results ?? []) {
    if (!isRecord(item) || typeof item.url !== 'string' || item.url.length === 0 || seen.has(item.url)) {
      continue
    }
    seen.add(item.url)
    sources.push({
      url: item.url,
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
      ...(typeof item.description === 'string' ? { snippet: item.description } : {}),
    })
  }
  return { sources, truncated: false }
}
