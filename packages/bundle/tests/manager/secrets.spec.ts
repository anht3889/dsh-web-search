import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  BRAVE_API_KEY_REF,
  TAVILY_API_KEY_REF,
  createSecretStore,
  type CredentialsApi,
} from '../../src/manager/secrets.ts'

test('falls back to env when file and credentials are empty', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({
    filePath,
    env: () => ({ [TAVILY_API_KEY_REF]: 'from-env' }),
  })
  expect(await store.get(TAVILY_API_KEY_REF)).toBe('from-env')
  expect(await store.describe(TAVILY_API_KEY_REF)).toEqual({ configured: true })
})

test('file values win over env', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({ filePath, env: () => ({ [TAVILY_API_KEY_REF]: 'env' }) })
  await store.set(TAVILY_API_KEY_REF, 'file')
  expect(await store.get(TAVILY_API_KEY_REF)).toBe('file')
  expect(await readFile(filePath, 'utf8')).not.toMatch(/env/)
})

test('empty set does not wipe', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({ filePath, env: () => ({}) })
  await store.set(TAVILY_API_KEY_REF, 'keep')
  await store.set(TAVILY_API_KEY_REF, '')
  expect(await store.get(TAVILY_API_KEY_REF)).toBe('keep')
})

test('credentials win when they return a value', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({
    filePath,
    env: () => ({ [BRAVE_API_KEY_REF]: 'env' }),
    credentials: () => ({
      resolve: async (ref) => ref === BRAVE_API_KEY_REF ? { value: 'cred' } : undefined,
      describe: async (ref) => ({ configured: ref === BRAVE_API_KEY_REF }),
      set: async () => {},
      unset: async () => {},
    }),
  })
  expect(await store.get(BRAVE_API_KEY_REF)).toBe('cred')
})

test('an empty credential value falls through to the file and environment', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({
    filePath,
    env: () => ({ [BRAVE_API_KEY_REF]: 'env' }),
    credentials: () => ({
      resolve: async () => ({ value: '' }),
      describe: async () => ({ configured: true }),
      set: async () => {},
      unset: async () => {},
    }),
  })
  expect(await store.get(BRAVE_API_KEY_REF)).toBe('env')
})

test('a credential service mounted after creation is used on the next read', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  let mounted: CredentialsApi | undefined
  const store = createSecretStore({
    filePath,
    env: () => ({ [TAVILY_API_KEY_REF]: 'env' }),
    credentials: () => mounted,
  })

  expect(await store.get(TAVILY_API_KEY_REF)).toBe('env')

  mounted = {
    resolve: async () => ({ value: 'late-cred' }),
    describe: async () => ({ configured: true }),
    set: async () => {},
    unset: async () => {},
  }

  expect(await store.get(TAVILY_API_KEY_REF)).toBe('late-cred')
  expect(await store.describe(TAVILY_API_KEY_REF)).toEqual({ configured: true })
})

test('removing the credential service falls back to the file', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  await writeFile(filePath, `${TAVILY_API_KEY_REF}: ${JSON.stringify('from-file')}\n`, 'utf8')
  let mounted: CredentialsApi | undefined = {
    resolve: async () => ({ value: 'cred' }),
    describe: async () => ({ configured: true }),
    set: async () => {},
    unset: async () => {},
  }
  const store = createSecretStore({ filePath, env: () => ({}), credentials: () => mounted })

  expect(await store.get(TAVILY_API_KEY_REF)).toBe('cred')

  mounted = undefined

  expect(await store.get(TAVILY_API_KEY_REF)).toBe('from-file')
})

test('credential-backed set delegates to credentials and skips fallback file', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const setCalls: Array<{ ref: string; value: string }> = []
  const store = createSecretStore({
    filePath,
    env: () => ({}),
    credentials: () => ({
      resolve: async () => undefined,
      describe: async () => ({ configured: false }),
      set: async (ref, value) => {
        setCalls.push({ ref, value })
      },
      unset: async () => {},
    }),
  })

  await store.set(TAVILY_API_KEY_REF, 'via-credentials')

  expect(setCalls).toEqual([{ ref: TAVILY_API_KEY_REF, value: 'via-credentials' }])
  await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

test('writes follow the credential service mounted at write time', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const setCalls: string[] = []
  let mounted: CredentialsApi | undefined
  const store = createSecretStore({ filePath, env: () => ({}), credentials: () => mounted })

  await store.set(TAVILY_API_KEY_REF, 'before-mount')
  expect(await readFile(filePath, 'utf8')).toContain('before-mount')

  mounted = {
    resolve: async () => undefined,
    describe: async () => ({ configured: false }),
    set: async (_ref, value) => {
      setCalls.push(value)
    },
    unset: async () => {},
  }
  await store.set(BRAVE_API_KEY_REF, 'after-mount')

  expect(setCalls).toEqual(['after-mount'])
  expect(await readFile(filePath, 'utf8')).not.toContain('after-mount')
})

test('credential-backed set does not modify an existing fallback file', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const existing = `${BRAVE_API_KEY_REF}: ${JSON.stringify('existing')}\n`
  await writeFile(filePath, existing, 'utf8')

  const store = createSecretStore({
    filePath,
    env: () => ({}),
    credentials: () => ({
      resolve: async () => undefined,
      describe: async () => ({ configured: false }),
      set: async () => {},
      unset: async () => {},
    }),
  })

  await store.set(TAVILY_API_KEY_REF, 'via-credentials')
  expect(await readFile(filePath, 'utf8')).toBe(existing)
})

test('file-backed set writes owner-only permissions', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({ filePath, env: () => ({}) })

  await store.set(TAVILY_API_KEY_REF, 'secret')

  const mode = (await stat(filePath)).mode & 0o777
  expect(mode).toBe(0o600)
})

test('propagates chmod failures instead of leaving permissive files', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const permissionError = Object.assign(new Error('chmod failed'), { code: 'EPERM' })
  const store = createSecretStore({
    filePath,
    env: () => ({}),
    applyFileMode: async () => {
      throw permissionError
    },
  })

  await expect(store.set(TAVILY_API_KEY_REF, 'secret')).rejects.toThrow('chmod failed')
})
