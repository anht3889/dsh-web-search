/** Typed global `fetch` stubs for engine and provider tests. */

import { vi } from 'vitest'

/**
 * Replaces global `fetch` with a mock whose recorded calls stay typed, so tests
 * can read `mock.calls[n]` for the request URL and init.
 *
 * @param respond - Builds the response for one recorded request.
 * @returns The installed mock.
 */
export function stubFetch(
  respond: (url: string | URL, init: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(
    async (url: string | URL, init: RequestInit): Promise<Response> => respond(url, init),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
