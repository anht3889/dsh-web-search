/** Response fixtures for bounded provider body reads. */

/**
 * Builds a response whose body stream fails with an abort after zero or more chunks.
 *
 * @param status - HTTP status of the response.
 * @param prefix - Bytes delivered before the abort.
 * @returns A response that aborts while its body is read.
 */
export function abortingResponse(status: number, prefix = ''): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix.length > 0) controller.enqueue(new TextEncoder().encode(prefix))
      controller.error(new DOMException('aborted', 'AbortError'))
    },
  })
  return new Response(stream, { status })
}

/**
 * Builds a response whose body arrives as separate stream chunks.
 *
 * @param chunks - Body chunks delivered in order.
 * @param status - HTTP status of the response.
 * @returns A chunked response.
 */
export function chunkedResponse(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status })
}
