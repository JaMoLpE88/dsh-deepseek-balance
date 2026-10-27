/**
 * DeepSeek balance client for dsh-deepseek-balance.
 *
 * Two official sources feed the same normalized view:
 *
 *   GET https://api.deepseek.com/user/balance
 *   Authorization: Bearer <DEEPSEEK_API_KEY>
 *
 *   ctx.deepseekAccount.getBalance(client)   (a signed-in DeepSeek account)
 *
 * Both answer per currency with a topped-up part and a granted part. The
 * granted part is the one that can expire, but no reachable endpoint exposes
 * that date, so the view carries no expiry.
 *
 * @module dsh-deepseek-balance/balance
 */

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com/user/balance'
export const TIMEOUT_MS = 10_000

/** A balance failure with a short, stable code the browser can render. */
export class BalanceError extends Error {
  /**
   * @param {string} message human-readable, secret-free message
   * @param {string} code short code: missing-key, invalid-key, forbidden,
   *   rate-limited, timeout, network, parse, account, http-<status>
   */
  constructor(message, code) {
    super(message)
    this.name = 'BalanceError'
    this.code = code
  }
}

/**
 * Fetch and normalize the balance from the official API key endpoint.
 * @param {string} apiKey DeepSeek API key (never included in errors)
 * @param {{ endpoint?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ currencies: BalanceCurrency[], available: boolean | null }>}
 */
export async function fetchBalance(apiKey, options = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new BalanceError('No DeepSeek API key is available.', 'missing-key')
  }

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch

  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey.trim()}`,
        accept: 'application/json',
        'user-agent': 'dsh-deepseek-balance/0.1.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new BalanceError(`The balance request timed out after ${timeoutMs} ms.`, 'timeout')
    }
    throw new BalanceError('Could not reach the DeepSeek balance API.', 'network')
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response)
    throw new BalanceError(detail ?? statusMessage(response.status), statusCode(response.status))
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new BalanceError('The balance API returned a non-JSON response.', 'parse')
  }
  return parseBalance(body)
}

/**
 * Normalize the `/user/balance` payload.
 * @param {unknown} body
 * @returns {{ currencies: BalanceCurrency[], available: boolean | null }}
 */
export function parseBalance(body) {
  const infos = body !== null && typeof body === 'object' ? body.balance_infos : undefined
  if (!Array.isArray(infos)) {
    throw new BalanceError('The balance response did not contain balances.', 'parse')
  }

  const currencies = []
  for (const info of infos) {
    const currency = currencyOf(info?.currency)
    if (currency === undefined) continue
    const toppedUp = amountOf(info?.topped_up_balance) ?? '0'
    const granted = amountOf(info?.granted_balance) ?? '0'
    currencies.push({
      currency,
      toppedUp,
      granted,
      total: amountOf(info?.total_balance) ?? addAmounts(toppedUp, granted),
    })
  }

  const available = body !== null && typeof body === 'object' && typeof body.is_available === 'boolean'
    ? body.is_available
    : null
  return { currencies, available }
}

/**
 * Normalize the signed-in account's wallets into the same currency entries.
 * @param {readonly { currency: string, balance: string }[]} wallets topped-up wallets
 * @param {readonly { currency: string, balance: string }[]} bonusWallets granted wallets
 * @returns {BalanceCurrency[]}
 */
export function parseWallets(wallets, bonusWallets) {
  /** @type {Map<string, { currency: string, toppedUp: string, granted: string }>} */
  const byCurrency = new Map()

  /** @param {unknown} list @param {'toppedUp' | 'granted'} part */
  const take = (list, part) => {
    if (!Array.isArray(list)) return
    for (const wallet of list) {
      const currency = currencyOf(wallet?.currency)
      if (currency === undefined) continue
      const entry = byCurrency.get(currency) ?? { currency, toppedUp: '0', granted: '0' }
      entry[part] = amountOf(wallet.balance) ?? '0'
      byCurrency.set(currency, entry)
    }
  }
  take(wallets, 'toppedUp')
  take(bonusWallets, 'granted')

  return [...byCurrency.values()].map((entry) => ({
    ...entry,
    total: addAmounts(entry.toppedUp, entry.granted),
  }))
}

/**
 * Add two decimal strings without floating-point noise.
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
export function addAmounts(left, right) {
  const sum = Number(left) + Number(right)
  if (!Number.isFinite(sum)) return '0'
  return sum.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0'
}

/**
 * @param {unknown} value
 * @returns {string | undefined} uppercase ISO code, or undefined when unusable
 */
function currencyOf(value) {
  if (typeof value !== 'string') return undefined
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : undefined
}

/**
 * @param {unknown} value
 * @returns {string | undefined} the decimal text as sent, or undefined
 */
function amountOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? text : undefined
}

/** @param {number} status */
function statusCode(status) {
  if (status === 401) return 'invalid-key'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate-limited'
  return `http-${status}`
}

/** @param {number} status */
function statusMessage(status) {
  if (status === 401) return 'The DeepSeek API key was rejected.'
  if (status === 403) return 'This key cannot read the DeepSeek balance.'
  if (status === 429) return 'The balance API is rate limited; try again shortly.'
  return `The balance API answered HTTP ${status}.`
}

/**
 * Read the API's error message without ever echoing the request key.
 * @param {Response} response
 * @returns {Promise<string | undefined>}
 */
async function readErrorMessage(response) {
  try {
    const text = await response.text()
    if (!text) return undefined
    try {
      const body = JSON.parse(text)
      const message = body?.error?.message ?? body?.message
      if (typeof message === 'string' && message.length > 0) return message.slice(0, 200)
    } catch {
      return text.slice(0, 200)
    }
  } catch {
    // The status message is enough.
  }
  return undefined
}

/**
 * @typedef {object} BalanceCurrency
 * @property {string} currency ISO code as returned by the source
 * @property {string} toppedUp topped-up amount, decimal text
 * @property {string} granted granted amount, decimal text
 * @property {string} total topped-up plus granted, decimal text
 */
