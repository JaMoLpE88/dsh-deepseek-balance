import test from 'node:test'
import assert from 'node:assert/strict'
import { BalanceService } from '../index.js'

const payload = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '8.23', granted_balance: '0.00', topped_up_balance: '8.23' },
  ],
}

/** A Host context with only the services the plugin reads. */
function makeCtx(key, account) {
  return {
    get(name) {
      if (name === 'credentials') {
        return {
          async resolve(ref) {
            if (ref !== 'DEEPSEEK_API_KEY') return undefined
            return key === undefined ? undefined : { value: key }
          },
        }
      }
      if (name === 'deepseekAccount') return account
      return undefined
    },
  }
}

/** Install a fetch double and the matching environment for one test. */
function withFetch(implementation, fn) {
  const previousFetch = globalThis.fetch
  const previousEnv = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  globalThis.fetch = implementation
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = previousFetch
    if (previousEnv === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousEnv
  })
}

test('caches a success and refresh bypasses the cache', async () => {
  let calls = 0
  await withFetch(async () => {
    calls += 1
    return new Response(JSON.stringify(payload), { status: 200 })
  }, async () => {
    const service = new BalanceService(makeCtx('test-key'))
    const first = await service.view()
    assert.equal(first.error, null)
    assert.equal(first.source, 'api-key')
    assert.equal(first.currencies[0].toppedUp, '8.23')

    const second = await service.view()
    assert.equal(second.currencies[0].total, '8.23')
    assert.equal(calls, 1)

    await service.refresh()
    assert.equal(calls, 2)
  })
})

test('reports a missing key without calling the network', async () => {
  let calls = 0
  await withFetch(async () => {
    calls += 1
    return new Response(JSON.stringify(payload), { status: 200 })
  }, async () => {
    const service = new BalanceService(makeCtx(undefined))
    const view = await service.view()
    assert.equal(view.error.code, 'missing-key')
    assert.equal(view.currencies, null)
    assert.equal(calls, 0)
  })
})

test('reads the signed-in account when no API key exists', async () => {
  let calls = 0
  const account = {
    async getBalance(client) {
      assert.equal(typeof client.version, 'string')
      return {
        status: 'ready',
        value: [{ currency: 'USD', balance: '4.10' }],
        bonusWallets: [{ currency: 'CNY', balance: '120.00' }],
      }
    },
  }
  await withFetch(async () => {
    calls += 1
    return new Response(JSON.stringify(payload), { status: 200 })
  }, async () => {
    const service = new BalanceService(makeCtx(undefined, account))
    const view = await service.view()
    assert.equal(view.error, null)
    assert.equal(view.source, 'account')
    assert.equal(view.currencies.length, 2)
    assert.equal(view.currencies[0].toppedUp, '4.10')
    assert.equal(view.currencies[1].granted, '120.00')
    assert.equal(calls, 0)
  })
})

test('reports a signed-out account distinctly', async () => {
  const account = { async getBalance() { return null } }
  await withFetch(async () => new Response(JSON.stringify(payload), { status: 200 }), async () => {
    const service = new BalanceService(makeCtx(undefined, account))
    const view = await service.view()
    assert.equal(view.error.code, 'signed-out')
  })
})

test('reports an unreadable account', async () => {
  const account = { async getBalance() { return { status: 'failed' } } }
  await withFetch(async () => new Response(JSON.stringify(payload), { status: 200 }), async () => {
    const service = new BalanceService(makeCtx(undefined, account))
    const view = await service.view()
    assert.equal(view.error.code, 'account')
  })
})

test('keeps the last balances and marks them stale after a failure', async () => {
  let calls = 0
  let mode = 'ok'
  await withFetch(async () => {
    calls += 1
    if (mode === 'fail') {
      return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 })
    }
    return new Response(JSON.stringify(payload), { status: 200 })
  }, async () => {
    const service = new BalanceService(makeCtx('test-key'))
    await service.view()
    mode = 'fail'

    const failed = await service.refresh()
    assert.equal(failed.error.code, 'invalid-key')
    assert.equal(failed.stale, true)
    assert.equal(failed.currencies[0].toppedUp, '8.23')
    assert.equal(failed.source, 'api-key')

    // A cached success must not hide the failure inside the cooldown window.
    const next = await service.view()
    assert.equal(next.error.code, 'invalid-key')
    assert.equal(next.stale, true)
    assert.equal(calls, 2)
  })
})

test('falls back to DEEPSEEK_API_KEY when no credential service is present', async () => {
  const previousEnv = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'env-key'
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 })
  try {
    const service = new BalanceService({ get: () => undefined })
    const view = await service.view()
    assert.equal(view.error, null)
    assert.equal(view.currencies[0].toppedUp, '8.23')
  } finally {
    globalThis.fetch = previousFetch
    if (previousEnv === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousEnv
  }
})
