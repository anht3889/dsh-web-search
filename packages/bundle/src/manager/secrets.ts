/**
 * Secret storage for web-search API keys.
 * @module @anht3889/dsh-web-search-bundle/manager/secrets
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Credential reference for the Tavily search API key. */
export const TAVILY_API_KEY_REF = 'TAVILY_API_KEY' as const

/** Credential reference for the Brave search API key. */
export const BRAVE_API_KEY_REF = 'BRAVE_API_KEY' as const

/** Supported web-search secret references. */
export type SecretRef = typeof TAVILY_API_KEY_REF | typeof BRAVE_API_KEY_REF

/** The resolved value returned by the harness credential provider. */
export interface ResolvedCredential {
  /** The secret value. */
  value: string
}

/** Minimal harness credential service consumed by the secret store. */
export interface CredentialsApi {
  /**
   * Resolves a credential reference.
   *
   * @param ref - The credential reference to resolve.
   * @returns The resolved credential, or `undefined` when it is not configured.
   */
  resolve(ref: string): Promise<ResolvedCredential | undefined>
  /**
   * Describes a credential reference without exposing its value.
   *
   * @param ref - The credential reference to describe.
   * @returns Its configured state.
   */
  describe(ref: string): Promise<{ configured: boolean }>
  /**
   * Stores a credential value.
   *
   * @param ref - The credential reference to update.
   * @param value - The secret value to store.
   */
  set(ref: string, value: string): Promise<void>
  /**
   * Removes a credential value.
   *
   * @param ref - The credential reference to remove.
   */
  unset(ref: string): Promise<void>
}

/** A value-free view of one secret's configured state. */
export interface SecretDescription {
  /** Whether a value is configured for the requested key. */
  configured: boolean
}

/** Operations for web-search API key secrets. */
export interface SecretStore {
  /**
   * Resolves a secret value.
   *
   * @param ref - The secret reference to resolve.
   * @returns The configured secret value, if any.
   */
  get(ref: SecretRef): Promise<string | undefined>
  /**
   * Stores a secret value via credentials when mounted, else the fallback file.
   *
   * @param ref - The secret reference to update.
   * @param value - The secret value to store; empty strings are ignored.
   */
  set(ref: SecretRef, value: string): Promise<void>
  /**
   * Describes one secret without exposing its value.
   *
   * @param ref - The secret reference to describe.
   * @returns Whether the secret is configured.
   */
  describe(ref: SecretRef): Promise<SecretDescription>
}

/**
 * Returns the harness credential service while it is mounted.
 *
 * @returns The mounted credential service, or `undefined` when none is mounted.
 */
export type CredentialsAccessor = () => CredentialsApi | undefined

/** Dependencies used to create a secret store. */
export interface SecretStoreOptions {
  /**
   * Reads the harness credential service, whose values are preferred over file
   * and environment values when non-empty. The accessor runs on every get,
   * set, and describe, so a credential service mounted or removed after the
   * manager loaded takes effect on the next operation.
   */
  credentials?: CredentialsAccessor
  /** Fallback file that holds secret references and their values. */
  filePath: string
  /** Process environment lookup for secret references. */
  env: () => NodeJS.Dict<string>
  /**
   * Applies owner-only permissions after writing the fallback file.
   * Defaults to `chmod(path, 0o600)`; inject in tests to assert failure propagation.
   */
  applyFileMode?: (filePath: string) => Promise<void>
}

/**
 * Creates a secret store backed by credentials, a private fallback file, or env.
 *
 * @param options - Credential service, fallback file location, and env lookup.
 * @returns A secret store for web-search API keys.
 */
export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const { credentials, filePath, env } = options
  const applyFileMode = options.applyFileMode ?? defaultApplyFileMode
  const mutate = createMutationQueue()

  return {
    async get(ref) {
      return resolveSecret(ref, credentials?.(), filePath, env)
    },
    async set(ref, value) {
      if (value.length === 0) return
      const mounted = credentials?.()
      if (mounted !== undefined) {
        await mutate(async () => {
          await mounted.set(ref, value)
        })
        return
      }
      await mutate(async () => {
        const values = await loadSecretsFile(filePath)
        values[ref] = value
        await saveSecretsFile(filePath, values, applyFileMode)
      })
    },
    async describe(ref) {
      const value = await resolveSecret(ref, credentials?.(), filePath, env)
      return { configured: value !== undefined }
    },
  }
}

/**
 * Resolves a secret using credentials, file, then env precedence.
 *
 * @param ref - The secret reference to resolve.
 * @param credentials - The credential service mounted for this operation, if any.
 * @param filePath - Fallback secrets file path.
 * @param env - Process environment lookup.
 * @returns The configured secret value, if any.
 */
async function resolveSecret(
  ref: SecretRef,
  credentials: CredentialsApi | undefined,
  filePath: string,
  env: () => NodeJS.Dict<string>,
): Promise<string | undefined> {
  if (credentials !== undefined) {
    const resolved = await credentials.resolve(ref)
    if (resolved !== undefined && resolved.value.length > 0) {
      return resolved.value
    }
  }

  const fileValue = (await loadSecretsFile(filePath))[ref]
  if (fileValue !== undefined && fileValue.length > 0) {
    return fileValue
  }

  const envValue = env()[ref]
  if (envValue !== undefined && envValue.length > 0) {
    return envValue
  }

  return undefined
}

/** Serializes read-modify-write secret file updates. */
function createMutationQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail = Promise.resolve()
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation)
    tail = result.then(() => undefined, () => undefined)
    return await result
  }
}

/**
 * Loads secret values from a line-oriented YAML-compatible file.
 *
 * @param filePath - The secrets file path.
 * @returns Secret references and their values.
 */
async function loadSecretsFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(filePath, 'utf8')
    const values: Record<string, string> = {}

    for (const line of content.split('\n')) {
      if (line.length === 0) continue

      const separatorIndex = line.indexOf(': ')
      if (separatorIndex === -1) {
        throw new TypeError(`Secret file ${filePath} contains an invalid line: ${line}`)
      }

      const key = line.slice(0, separatorIndex)
      const parsed: unknown = JSON.parse(line.slice(separatorIndex + 2))
      if (typeof parsed !== 'string') {
        throw new TypeError(`Secret file ${filePath} must contain string values`)
      }

      values[key] = parsed
    }

    return values
  } catch (error: unknown) {
    if (isMissingFileError(error)) return {}
    throw error
  }
}

/**
 * Stores secret values with owner-only file permissions where supported.
 *
 * @param filePath - The secrets file path.
 * @param values - Secret references and values to store.
 * @param applyFileMode - Applies owner-only permissions after the write.
 */
async function saveSecretsFile(
  filePath: string,
  values: Record<string, string>,
  applyFileMode: (filePath: string) => Promise<void>,
): Promise<void> {
  const content = Object.entries(values)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`)
    .join('')

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 })
  await applyFileMode(filePath)
}

/** Applies owner-only permissions to a private fallback file. */
async function defaultApplyFileMode(filePath: string): Promise<void> {
  await chmod(filePath, 0o600)
}

/**
 * Checks whether a file-system operation failed because a file was absent.
 *
 * @param error - The thrown file-system error.
 * @returns Whether the error reports an absent file.
 */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
