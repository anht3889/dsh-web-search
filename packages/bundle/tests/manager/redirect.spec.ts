import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, test } from 'vitest'
import type { WebError } from '@deepseek-ai/dsh-web'
import { braveSearch } from '../../src/manager/engines/brave.ts'
import { searxngSearch } from '../../src/manager/engines/searxng.ts'
import { tavilySearch } from '../../src/manager/engines/tavily.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close))
})

interface RedirectFixture {
  redirectOrigin: string
  targetOrigin: string
  redirected: IncomingHttpHeaders[]
  targetRequests: IncomingHttpHeaders[]
}

test.each([
  {
    engine: 'Tavily',
    run: async (origin: string) =>
      await tavilySearch({ query: 'q' }, { baseURL: origin, apiKey: 'tavily-secret' }),
    credentialHeader: 'authorization',
  },
  {
    engine: 'Brave',
    run: async (origin: string) =>
      await braveSearch({ query: 'q' }, { baseURL: origin, apiKey: 'brave-secret' }),
    credentialHeader: 'x-subscription-token',
  },
])('$engine credentialed requests fail on a redirect without contacting Location', async (engineCase) => {
  const fixture = await startRedirectFixture()

  const failure = await engineCase.run(fixture.redirectOrigin)
    .then(() => undefined, (error: unknown) => error as WebError)

  expect(failure?.code).toBe('WEB_PROVIDER_ERROR')
  expect(fixture.redirected).toHaveLength(1)
  expect(fixture.redirected[0]?.[engineCase.credentialHeader]).toContain('secret')
  expect(fixture.targetRequests).toEqual([])
})

test('SearXNG requests fail on a redirect without contacting Location', async () => {
  const fixture = await startRedirectFixture()

  await expect(searxngSearch({ query: 'q' }, { baseURL: fixture.redirectOrigin }))
    .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' } satisfies Partial<WebError>)
  expect(fixture.redirected).toHaveLength(1)
  expect(fixture.targetRequests).toEqual([])
})

async function startRedirectFixture(): Promise<RedirectFixture> {
  const targetRequests: IncomingHttpHeaders[] = []
  const redirected: IncomingHttpHeaders[] = []

  const target = await listen(createServer((request, response) => {
    targetRequests.push(request.headers)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"results":[]}')
  }))
  const targetOrigin = origin(target)

  const redirector = await listen(createServer((request, response) => {
    redirected.push(request.headers)
    response.writeHead(302, { location: `${targetOrigin}${request.url ?? '/'}` })
    response.end()
  }))

  return { redirectOrigin: origin(redirector), targetOrigin, redirected, targetRequests }
}

async function listen(server: Server): Promise<Server> {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return server
}

function origin(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}
