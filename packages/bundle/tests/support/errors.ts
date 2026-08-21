/** Rejection capture for assertions on individual {@link WebError} fields. */

import type { WebError } from '@deepseek-ai/dsh-web'

/**
 * Awaits a provider call that must reject and returns the thrown error.
 *
 * @param operation - The provider call under test.
 * @returns The rejection value.
 * @throws When the operation resolves instead of rejecting.
 */
export async function captureWebError(operation: Promise<unknown>): Promise<WebError> {
  try {
    await operation
  } catch (error: unknown) {
    return error as WebError
  }
  throw new Error('expected the provider call to reject')
}
