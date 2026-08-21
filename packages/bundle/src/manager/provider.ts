/**
 * Multi-engine web-search provider.
 * @module @anht3889/dsh-web-search-bundle/manager/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { braveSearch } from './engines/brave.ts'
import { searxngSearch } from './engines/searxng.ts'
import { tavilySearch } from './engines/tavily.ts'
import { BRAVE_API_KEY_REF, TAVILY_API_KEY_REF } from './secrets.ts'
import {
  BRAVE_DEFAULT_BASE_URL,
  type SearchEngineId,
  TAVILY_DEFAULT_BASE_URL,
  type WebSearchCatalog,
} from './types.ts'

/** Provider id registered with the harness web capability. */
export const WEB_SEARCH_PROVIDER_ID = 'dsh-web-search'

/** Dependencies for {@link MultiEngineSearchProvider}. */
export interface ProviderDeps {
  /** Returns the current catalog snapshot. */
  catalog: () => WebSearchCatalog
  /**
   * Resolves Tavily or Brave API keys.
   *
   * @param ref - The credential reference to resolve.
   * @returns The configured key, if any.
   */
  resolveKey: (ref: typeof TAVILY_API_KEY_REF | typeof BRAVE_API_KEY_REF) => Promise<string | undefined>
}

/**
 * Resolves the base URL for one engine from catalog overrides and defaults.
 *
 * @param catalog - The catalog snapshot for this search.
 * @param engine - The selected search engine.
 * @returns The base URL string; SearXNG is empty when unset.
 */
export function resolvedBaseURL(catalog: WebSearchCatalog, engine: SearchEngineId): string {
  switch (engine) {
    case 'tavily':
      return catalog.engines.tavily?.baseURL ?? TAVILY_DEFAULT_BASE_URL
    case 'brave':
      return catalog.engines.brave?.baseURL ?? BRAVE_DEFAULT_BASE_URL
    case 'searxng':
      return catalog.engines.searxng?.baseURL ?? ''
  }
}

/** Dispatches search requests to Tavily, Brave, or SearXNG based on catalog state. */
export class MultiEngineSearchProvider implements WebSearchProvider {
  readonly id = WEB_SEARCH_PROVIDER_ID

  /**
   * @param deps - Catalog accessor and key resolver.
   */
  constructor(private readonly deps: ProviderDeps) {}

  /** Whether the current catalog selects a usable engine and base URL. */
  available(): boolean {
    const catalog = this.deps.catalog()
    const engine = catalog.engine
    if (engine === null) return false
    return URL.canParse(resolvedBaseURL(catalog, engine))
  }

  /**
   * Runs one search using the catalog read at call time.
   *
   * @param request - Search query and optional result limit.
   * @param signal - Optional cancellation signal forwarded to the adapter.
   * @returns The provider-normalized search result.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const catalog = this.deps.catalog()
    const engine = catalog.engine
    if (engine === null || !URL.canParse(resolvedBaseURL(catalog, engine))) {
      throw new WebError('web-search engine is not configured', 'WEB_PROVIDER_ERROR')
    }

    const baseURL = resolvedBaseURL(catalog, engine)

    switch (engine) {
      case 'tavily': {
        const apiKey = await this.deps.resolveKey(TAVILY_API_KEY_REF)
        if (apiKey === undefined || apiKey.length === 0) {
          throw new WebError(
            `tavily search credential is missing; set ${TAVILY_API_KEY_REF} in Settings or the environment`,
            'WEB_PROVIDER_ERROR',
          )
        }
        return tavilySearch(request, { baseURL, apiKey }, signal)
      }
      case 'brave': {
        const apiKey = await this.deps.resolveKey(BRAVE_API_KEY_REF)
        if (apiKey === undefined || apiKey.length === 0) {
          throw new WebError(
            `brave search credential is missing; set ${BRAVE_API_KEY_REF} in Settings or the environment`,
            'WEB_PROVIDER_ERROR',
          )
        }
        return braveSearch(request, { baseURL, apiKey }, signal)
      }
      case 'searxng':
        return searxngSearch(request, { baseURL }, signal)
    }
  }
}
