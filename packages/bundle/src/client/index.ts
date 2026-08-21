/**
 * Browser plugin registering the web-search Settings section.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { WebSearchApi } from './api.ts'
import { en, zh, type WebSearchSettingsKey } from './locales.ts'
import { WebSearchSection } from './WebSearchSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the web-search Settings page. */
    'settings.web-search': WebSearchSettingsKey
  }
}

const NS = 'settings.web-search'

/** Required client services. */
export const inject = ['slots', 'locale']

/**
 * Registers web-search configuration under the Settings navigation slot.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-web-search: copy dictionaries')
  const api = new WebSearchApi()
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'web-search',
    order: 45,
    locale: NS,
    label: () => t('nav'),
    inject: () => ({ api, t }),
  }, WebSearchSection))
}
