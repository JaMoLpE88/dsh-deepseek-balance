import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchBalance, parseBalance, parseWallets, addAmounts, BalanceError } from '../balance.js'

const livePayload = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '8.23', granted_balance: '0.00', topped_up_balance: '8.23' },
  ],
}

const multiPayload = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '8.23', granted_balance: '0.00', topped_up_balance: '8.23' },
    { currency: 'CNY', total_balance: '120.00', granted_balance: '120.00', topped_up_balance: '0.00' },
  ],
}

test('parseBalance reads the live single-currency payload', () => {
  const { currencies, available } = parseBalance(livePayload)
  assert.equal(available, true)
  assert.equal(currencies.length, 1)
  assert.equal(currencies[0].currency, 'USD')
  assert.equal(currencies[0].toppedUp, '8.23')
  assert.equal(currencies[0].granted, '0.00')
  assert.equal(currencies[0].total, '8.23')
})

test('parseBalance keeps every currency, zeros included', () => {
  const { currencies } = parseBalance(multiPayload)
  assert.deepEqual(currencies.map((entry) => entry.currency), ['USD', 'CNY'])
  assert.equal(currencies[1].toppedUp, '0.00')
  assert.equal(currencies[1].granted, '120.00')
  assert.equal(currencies[1].total, '120.00')
})

test('parseBalance computes a missing total and skips unusable entries', () => {
  const { currencies } = parseBalance({
    balance_infos: [
      { currency: 'usd', granted_balance: '1.50', topped_up_balance: '2.25' },
      { currency: 'not-a-code' },
      null,
    ],
  })
  assert.equal(currencies.length, 1)
  assert.equal(currencies[0].currency, 'USD')
  assert.equal(currencies[0].total, '3.75')
})

test('parseBalance rejects a payload without balances', () => {
  assert.throws(() => parseBalance({}), (error) => error instanceof BalanceError && error.code === 'parse')
  assert.throws(() => parseBalance({ balance_infos: null }), (error) => error.code === 'parse')
})

test('parseBalance accepts an empty wallet list', () => {
  const { currencies, available } = parseBalance({ balance_infos: [] })
  assert.deepEqual(currencies, [])
  assert.equal(available, null)
})

test('parseWallets merges topped-up and granted wallets per currency', () => {
  const currencies = parseWallets(
    [{ currency: 'USD', balance: '8.23' }, { currency: 'CNY', balance: '0' }],
    [{ currency: 'CNY', balance: '120.00' }],
  )
  assert.equal(currencies.length, 2)
  assert.deepEqual(currencies[0], { currency: 'USD', toppedUp: '8.23', granted: '0', total: '8.23' })
  assert.deepEqual(currencies[1], { currency: 'CNY', toppedUp: '0', granted: '120.00', total: '120' })
})

test('parseWallets keeps a currency that only has a granted balance', () => {
  const currencies = parseWallets([], [{ currency: 'CNY', balance: '5' }])
  assert.deepEqual(currencies, [{ currency: 'CNY', toppedUp: '0', granted: '5', total: '5' }])
})

test('parseWallets ignores malformed rows', () => {
  assert.deepEqual(parseWallets(undefined, [{ currency: 'EURO', balance: '1' }, null]), [])
})

test('addAmounts adds decimals without floating-point noise', () => {
  assert.equal(addAmounts('8.23', '0'), '8.23')
  assert.equal(addAmounts('0.1', '0.2'), '0.3')
  assert.equal(addAmounts('120', '0.5'), '120.5')
  assert.equal(addAmounts('0', '0'), '0')
  assert.equal(addAmounts('x', '1'), '0')
})

test('fetchBalance sends the key and normalizes a successful response', async () => {
  const { currencies } = await fetchBalance(' secret-key ', {
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/user/balance')
      assert.equal(init.headers.authorization, 'Bearer secret-key')
      return new Response(JSON.stringify(livePayload), { status: 200 })
    },
  })
  assert.equal(currencies[0].total, '8.23')
})

test('fetchBalance maps HTTP failures without echoing the key', async () => {
  await assert.rejects(
    fetchBalance('super-secret', {
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 }),
    }),
    (error) => {
      assert.ok(error instanceof BalanceError)
      assert.equal(error.code, 'invalid-key')
      assert.equal(error.message, 'Unauthorized')
      assert.equal(error.message.includes('super-secret'), false)
      return true
    },
  )

  await assert.rejects(
    fetchBalance('key', { fetchImpl: async () => new Response('', { status: 429 }) }),
    (error) => error instanceof BalanceError && error.code === 'rate-limited',
  )
})

test('fetchBalance maps network and timeout failures', async () => {
  await assert.rejects(
    fetchBalance('key', { fetchImpl: async () => { throw new TypeError('fetch failed') } }),
    (error) => error instanceof BalanceError && error.code === 'network',
  )
  await assert.rejects(
    fetchBalance('key', { fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError') } }),
    (error) => error instanceof BalanceError && error.code === 'timeout',
  )
})

test('fetchBalance rejects malformed JSON and a missing key', async () => {
  await assert.rejects(
    fetchBalance('key', { fetchImpl: async () => new Response('not json', { status: 200 }) }),
    (error) => error instanceof BalanceError && error.code === 'parse',
  )
  await assert.rejects(
    fetchBalance('  '),
    (error) => error instanceof BalanceError && error.code === 'missing-key',
  )
})
