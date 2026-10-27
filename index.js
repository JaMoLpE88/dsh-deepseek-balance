/**
 * dsh-deepseek-balance host half.
 *
 * Reads the DeepSeek Platform balance with the credential DSH already holds —
 * the `DEEPSEEK_API_KEY` of its `deepseek-official` provider, or the signed-in
 * DeepSeek account when no key is configured — caches the answer for a minute,
 * and exposes two same-origin read endpoints for the composer pill:
 *
 *   GET /api/deepseek-balance           cached view
 *   GET /api/deepseek-balance/refresh   force a fresh read
 *
 * There is no plugin configuration and no secret reaches the browser: the key
 * is resolved from DSH's credential service on each read.
 *
 * @module dsh-deepseek-balance
 */

import { fetchBalance, parseWallets, BalanceError } from './balance.js'

export const API_PREFIX = '/api/deepseek-balance'
export const CACHE_TTL_MS = 55_000
export const FAILURE_COOLDOWN_MS = 60_000
export const CREDENTIAL_REF = 'DEEPSEEK_API_KEY'

/** Identity the account service asks for; it is not a secret. */
export const ACCOUNT_CLIENT = {
  version: '0.1.0',
  locale: 'en',
  timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
}

/** Required Host services. */
export const inject = ['webServer']

/**
 * Resolve the DeepSeek key from DSH first, then the process environment.
 * The credential service is optional so the plugin still reports a clean
 * missing-key view on deployments that do not provide it.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<string | undefined>}
 */
async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const resolved = await credentials.resolve(CREDENTIAL_REF)
      const value = typeof resolved?.value === 'string' ? resolved.value.trim() : ''
      if (value.length > 0) return stripBearer(value)
    } catch {
      // Fall through to the environment.
    }
  }
  const fromEnv = process.env[CREDENTIAL_REF]
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return stripBearer(fromEnv.trim())
  return undefined
}

/** @param {string} value */
function stripBearer(value) {
  return value.replace(/^Bearer\s+/i, '').trim()
}

/**
 * Cached DeepSeek balance read. A failed upstream read keeps the last known
 * balances and marks the view stale; the next successful read replaces it.
 */
export class BalanceService {
  /** @param {import('@deepseek-ai/cordis').Context} ctx */
  constructor(ctx) {
    this.ctx = ctx
    /** @type {{ currencies: BalanceCurrency[], available: boolean | null, source: BalanceSource, updatedAt: number } | undefined} */
    this.cached = undefined
    this.cachedAt = 0
    this.failureUntilMs = 0
    /** @type {BalanceView | undefined} */
    this.lastView = undefined
    /** @type {Promise<BalanceView> | undefined} */
    this.inflight = undefined
    /** @type {Promise<BalanceView> | undefined} */
    this.refreshInflight = undefined
  }

  /**
   * Cached view when fresh, otherwise a read. Concurrent readers share one
   * upstream request.
   * @returns {Promise<BalanceView>}
   */
  async view() {
    const now = Date.now()
    if (this.cached !== undefined && now - this.cachedAt < CACHE_TTL_MS) {
      return successView(this.cached)
    }
    if (now < this.failureUntilMs && this.lastView !== undefined) {
      return this.lastView
    }
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.query().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  /**
   * Force a fresh upstream read, bypassing both the cache and the failure
   * cooldown.
   * @returns {Promise<BalanceView>}
   */
  async refresh() {
    if (this.refreshInflight !== undefined) return this.refreshInflight
    this.refreshInflight = this.query().finally(() => {
      this.refreshInflight = undefined
    })
    return this.refreshInflight
  }

  /**
   * @returns {Promise<BalanceView>}
   */
  async query() {
    let key
    try {
      key = await resolveApiKey(this.ctx)
    } catch (error) {
      return this.fail(asBalanceError(error))
    }

    if (key !== undefined) {
      try {
        const { currencies, available } = await fetchBalance(key)
        return this.succeed({ currencies, available, source: 'api-key' })
      } catch (error) {
        return this.fail(asBalanceError(error))
      }
    }

    // No key: read the signed-in DeepSeek account, when this Host has one.
    const account = this.ctx.get('deepseekAccount')
    if (account === undefined) {
      return this.fail(new BalanceError('No DeepSeek API key is available for this profile.', 'missing-key'))
    }

    let details
    try {
      details = await account.getBalance(ACCOUNT_CLIENT)
    } catch {
      return this.fail(new BalanceError('Could not read the signed-in DeepSeek account.', 'account'))
    }
    if (details === null) {
      return this.fail(new BalanceError('No DeepSeek account is signed in.', 'signed-out'))
    }
    if (details.status !== 'ready') {
      return this.fail(new BalanceError('The signed-in DeepSeek account could not be read.', 'account'))
    }
    return this.succeed({
      currencies: parseWallets(details.value, details.bonusWallets),
      available: null,
      source: 'account',
    })
  }

  /**
   * @param {{ currencies: BalanceCurrency[], available: boolean | null, source: BalanceSource }} data
   * @returns {BalanceView}
   */
  succeed(data) {
    const cached = { ...data, updatedAt: Date.now() }
    this.cached = cached
    this.cachedAt = cached.updatedAt
    this.failureUntilMs = 0
    this.lastView = successView(cached)
    return this.lastView
  }

  /**
   * Build a failure view from the last successful data, if any.
   * @param {BalanceError} error
   * @returns {BalanceView}
   */
  fail(error) {
    const cached = this.cached
    /** @type {BalanceView} */
    const view = {
      updatedAt: cached?.updatedAt ?? null,
      source: cached?.source ?? null,
      currencies: cached?.currencies ?? null,
      available: cached?.available ?? null,
      error: { code: error.code, message: error.message },
      stale: cached !== undefined,
    }
    this.lastView = view
    // The cached success must not mask the failure for the next reader: expire
    // it so view() serves this stale-and-error view during the cooldown.
    this.cachedAt = 0
    // A missing credential or session is a local condition: retrying is cheap
    // and the next read should see the key or login the user has just
    // configured. Upstream failures get the cooldown so a broken key is not
    // hammered.
    const local = error.code === 'missing-key' || error.code === 'signed-out'
    this.failureUntilMs = local ? 0 : Date.now() + FAILURE_COOLDOWN_MS
    return view
  }
}

/**
 * Turn an arbitrary thrown value into a BalanceError.
 * @param {unknown} error
 * @returns {BalanceError}
 */
function asBalanceError(error) {
  if (error instanceof BalanceError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new BalanceError(message, 'fetch')
}

/**
 * @param {{ currencies: BalanceCurrency[], available: boolean | null, source: BalanceSource, updatedAt: number }} data
 * @returns {BalanceView}
 */
function successView(data) {
  return {
    updatedAt: data.updatedAt,
    source: data.source,
    currencies: data.currencies,
    available: data.available,
    error: null,
    stale: false,
  }
}

/**
 * @typedef {'api-key' | 'account'} BalanceSource
 */

/**
 * @typedef {object} BalanceView
 * @property {number | null} updatedAt epoch milliseconds of the last success
 * @property {BalanceSource | null} source where the last success came from
 * @property {import('./balance.js').BalanceCurrency[] | null} currencies per-currency balances
 * @property {boolean | null} available the API's own "balance covers calls" flag
 * @property {{ code: string, message: string } | null} error
 * @property {boolean} stale true when currencies are the last known data
 */

/**
 * Register the two read-only routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const service = new BalanceService(ctx)
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register(makeRoute(API_PREFIX, () => service.view())),
      ctx.webServer.register(makeRoute(`${API_PREFIX}/refresh`, () => service.refresh())),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'deepseek-balance: routes')
}

/**
 * Build one exact GET route.
 * @param {string} path
 * @param {() => Promise<BalanceView>} run
 * @returns {import('@deepseek-ai/dsh-host-webserver').WebRoute}
 */
function makeRoute(path, run) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        writeJson(res, 405, { error: { code: 'method-not-allowed', message: 'Use GET.' } })
        return
      }
      Promise.resolve(run()).then(
        (view) => writeJson(res, 200, view),
        (error) => writeJson(res, 500, {
          error: { code: 'fetch', message: error instanceof Error ? error.message : String(error) },
        }),
      )
    },
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
