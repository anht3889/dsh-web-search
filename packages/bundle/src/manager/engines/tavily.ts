/**
 * Tavily web-search adapter.
 * @module @anht3889/dsh-web-search-bundle/manager/engines/tavily
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { engineUrl, isRecord, malformedBody, providerFetch, readErrorDetail, readJsonBody } from '../http.ts'

/** Endpoint and credential for one Tavily search. */
export interface TavilySearchOptions {
  /** Absolute Tavily API base URL. */
  readonly baseURL: string
  /** Tavily API key sent as a bearer token. */
  readonly apiKey: string
}

/** Engine-prefixed operation label used in Tavily error messages. */
const LABEL = 'Tavily search'

/**
 * Runs a Tavily search and normalizes its answer and sources.
 *
 * @param request - Search query and optional provider result limit.
 * @param options - Tavily endpoint and bearer token.
 * @param signal - Optional cancellation signal.
 * @returns The untruncated provider result.
 */
export async function tavilySearch(
  request: WebSearchRequest,
  options: TavilySearchOptions,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const response = await providerFetch(engineUrl(options.baseURL, 'search'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      query: request.query,
      include_answer: true,
      ...(request.maxResults !== undefined ? { max_results: request.maxResults } : {}),
    }),
    signal,
  }, LABEL)

  if (!response.ok) {
    const detail = await readErrorDetail(response, LABEL)
    throw new WebError(
      detail ?? `Tavily API error (HTTP ${response.status})`,
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
      ...(typeof item.published_date === 'string' ? { publishedAt: item.published_date } : {}),
    })
  }

  return {
    ...(typeof body.answer === 'string' && body.answer.length > 0 ? { content: body.answer } : {}),
    sources,
    truncated: false,
  }
}
