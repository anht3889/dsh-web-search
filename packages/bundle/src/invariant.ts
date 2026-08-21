/**
 * Package-owned invariant companion for the web-search Settings interface.
 * @module @anht3889/dsh-web-search-bundle/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@anht3889/dsh-web-search-bundle'

/** Cordis companion plugin name. */
export const name = 'web-search-bundle-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Empty companion: the manager persists a catalog file and registers one
 * search provider, but those are Host effects and a service method. Runtime
 * invariants may assert an owned event stream or mutable data relationship,
 * not service presence, so there is nothing this package can check here.
 */
const install: InvariantInstaller = () => {}

/**
 * Registers this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
