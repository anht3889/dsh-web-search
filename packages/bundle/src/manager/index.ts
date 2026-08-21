/**
 * Cordis plugin that registers the managed multi-engine search provider.
 * @module @anht3889/dsh-web-search-bundle/manager
 */

import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import { registerHttpApi, type WebSearchWebServer } from './http-api.ts'
import { WebSearchRuntime } from './runtime.ts'
import type { CredentialsApi } from './secrets.ts'

export { WebSearchRuntime } from './runtime.ts'
export type { SecretDescriptions, WebSearchRuntimeOptions } from './runtime.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-web-search'

/** The manager requires the harness web capability. */
export const inject = ['web']

/** Optional durable storage paths. */
export interface Config {
  /** Durable non-secret web-search catalog. */
  catalogPath?: string
  /** Private fallback storage used when credentials are unavailable. */
  secretsPath?: string
}

/** Loader schema with one shared user-home location for web-search data. */
export const Config: z<Config> = z.object({
  catalogPath: z.string().default(dshHomePath('web-search', 'config.json')),
  secretsPath: z.string().default(dshHomePath('web-search', 'secrets.yaml')),
})

/**
 * Loads the catalog, registers one live provider, and mounts HTTP when present.
 *
 * @param ctx - Plugin context containing the web service.
 * @param config - Resolved catalog and secret storage paths.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const runtime = await WebSearchRuntime.create({
    catalogPath: config.catalogPath ?? dshHomePath('web-search', 'config.json'),
    secretsPath: config.secretsPath ?? dshHomePath('web-search', 'secrets.yaml'),
    // Read per operation: the credential service is optional and may mount
    // after this plugin, so a snapshot taken here would keep using the file
    // and environment fallbacks for the rest of the process.
    credentials: () => ctx.get('credentials') as CredentialsApi | undefined,
  })

  ctx.effect(
    () => ctx.web.registerSearchProvider(runtime.provider()),
    'dsh-web-search.provider',
  )
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => registerHttpApi(httpCtx.get('webServer') as WebSearchWebServer, runtime),
      'dsh-web-search.http-api',
    )
  })
}
