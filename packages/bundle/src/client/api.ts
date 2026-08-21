/**
 * HTTP client and wire types for the web-search Settings section.
 * @module @anht3889/dsh-web-search-bundle/client/api
 */

// The catalog is one wire format owned by the manager's type module. Both
// statements are type-only, so no Host module reaches the browser bundle; the
// specifier ends in `.js` because the two compiler faces emit into different
// directories, which relative-extension rewriting rejects for a `.ts` path.
import type { WebSearchCatalog } from '../manager/types.js'

export type { EngineEndpoints, SearchEngineId, WebSearchCatalog } from '../manager/types.js'

/** Secret references accepted by the write-only secrets endpoint. */
export type WebSearchSecretRef = 'TAVILY_API_KEY' | 'BRAVE_API_KEY'

/** Value-free secret status returned by management reads. */
export type WebSearchSecretDescriptions = Record<WebSearchSecretRef, { configured: boolean }>

/** Complete non-secret view returned by the config endpoint. */
export interface WebSearchConfigView {
  catalog: WebSearchCatalog
  secrets: WebSearchSecretDescriptions
  available: boolean
}

/** HTTP client for web-search Settings routes. */
export class WebSearchApi {
  /**
   * @param baseUrl - Origin or relative prefix serving web-search routes.
   */
  constructor(private readonly baseUrl = '/web-search') {}

  /** @returns the current catalog and value-free availability state. */
  getConfig(): Promise<WebSearchConfigView> {
    return this.request('/config')
  }

  /**
   * @param catalog - Non-secret engine catalog to persist.
   * @returns the resulting non-secret config view.
   */
  putConfig(catalog: WebSearchCatalog): Promise<WebSearchConfigView> {
    return this.request('/config', { method: 'PUT', body: catalog })
  }

  /**
   * @param secrets - Non-empty write-only secret values.
   * @returns configured-state summaries, never secret values.
   */
  putSecrets(secrets: Partial<Record<WebSearchSecretRef, string>>): Promise<WebSearchSecretDescriptions> {
    return this.request('/secrets', { method: 'PUT', body: secrets })
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...(init.method === undefined ? {} : { method: init.method }),
      ...(init.body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(init.body),
          }),
    })
    if (!response.ok) {
      let detail: string | undefined
      try {
        const body = await response.json() as { error?: unknown }
        if (typeof body.error === 'string') detail = body.error
      } catch {
        // A failed route may return no JSON body; its HTTP status remains useful.
      }
      throw new Error(detail ?? `Web search request failed (${response.status})`)
    }
    return await response.json() as T
  }
}
