/**
 * dsh-deepseek-balance browser half.
 *
 * Registers one compact pill in the composer tool row. The pill is visible
 * only while the active model uses a DeepSeek provider, so the plugin needs no
 * configuration: if the provider is not selected, there is nothing to show.
 * Clicking the pill opens a DSH-style details dialog with every currency the
 * account holds, its topped-up, granted and total balance, and a manual
 * refresh.
 *
 * @module dsh-deepseek-balance/client
 */

window.__ModuleLoader__.load({
  id: '@jamolpe88/dsh-deepseek-balance',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    let createPortal = null
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      // A fixed-position panel still works without a portal in this shell.
    }

    // -----------------------------------------------------------------------
    // Copy
    // -----------------------------------------------------------------------

    const NS = 'deepseek-balance'

    const en = {
      'panelTitle': 'DeepSeek balance',
      'refresh': 'Refresh',
      'refreshing': 'Refreshing…',
      'lastUpdated': 'Last updated',
      'autoRefresh': 'Auto refresh',
      'everyMinute': 'Every 60 s',
      'source': 'Source',
      'sourceApi': 'DeepSeek API',
      'sourceAccount': 'DeepSeek account',
      'row.toppedUp': 'Topped-up',
      'row.granted': 'Granted',
      'row.total': 'Total',
      'summary': 'Total',
      'noBalance': 'No balance',
      'staleValue': 'Stale data',
      'insufficient': 'Balance does not cover API calls',
      'usage': 'Usage',
      'topUp': 'Top up',
      'pill.aria': 'DeepSeek balance: {summary}',
      'err.fetch': 'Could not read the balance',
      'err.missing-key': 'No DeepSeek API key',
      'err.signed-out': 'No DeepSeek account signed in',
      'err.invalid-key': 'DeepSeek key rejected',
      'err.forbidden': 'This key cannot read the balance',
      'err.account': 'Could not read the DeepSeek account',
      'err.rate-limited': 'Balance API rate limited',
      'err.timeout': 'Balance request timed out',
      'err.network': 'Could not reach the balance API',
      'err.parse': 'Unexpected balance response',
      'err.hint': 'The plugin reads the DeepSeek key DSH already holds, or the signed-in DeepSeek account. If this keeps failing, check the provider in Settings → Models.',
    }

    /** @param {string} key @param {Record<string, unknown>} [vars] @returns {string} */
    function fallbackT(key, vars) {
      let text = en[key] ?? key
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value))
        }
      }
      return text
    }

    /** @param {{ t?: (key: string, vars?: Record<string, unknown>) => string }} props */
    function translate(props) {
      return typeof props.t === 'function' ? props.t : fallbackT
    }

    // -----------------------------------------------------------------------
    // Formatting
    // -----------------------------------------------------------------------

    const POLL_MS = 60_000
    const VIEW_URL = '/api/deepseek-balance'
    const REFRESH_URL = '/api/deepseek-balance/refresh'
    const USAGE_URL = 'https://platform.deepseek.com/usage'
    const TOP_UP_URL = 'https://platform.deepseek.com/top_up'
    const DEEPSEEK_PROVIDERS = new Set(['deepseek-official', 'deepseek-account'])

    // Amounts always read like the DeepSeek Platform site: a dot decimal
    // separator and a comma for thousands, whatever the browser locale is.
    const AMOUNT_LOCALE = 'en-US'

    /** @type {Map<string, string>} */
    const SYMBOLS = new Map()

    /**
     * The currency's own symbol, from the browser's locale data; an unknown
     * code keeps the code itself.
     * @param {string} currency
     * @returns {string}
     */
    function symbolOf(currency) {
      const cached = SYMBOLS.get(currency)
      if (cached !== undefined) return cached
      let symbol = currency
      try {
        const parts = new Intl.NumberFormat(AMOUNT_LOCALE, {
          style: 'currency',
          currency,
          currencyDisplay: 'narrowSymbol',
        }).formatToParts(0)
        const found = parts.find((part) => part.type === 'currency')
        if (found !== undefined && found.value.length > 0) symbol = found.value
      } catch {
        // An unusable code keeps the code itself as its symbol.
      }
      SYMBOLS.set(currency, symbol)
      return symbol
    }

    /**
     * Format one amount with the currency symbol, two decimals rounded down
     * and grouped digits — the rules DSH's own account page uses.
     * @param {string} amount
     * @param {string} currency
     * @returns {string}
     */
    function formatAmount(amount, currency) {
      const value = Number(amount)
      if (!Number.isFinite(value)) return '—'
      const symbol = symbolOf(currency)
      if (value === 0) return `${symbol}0.00`
      if (value < 0) return `-${symbol}${Math.abs(value) < 0.01 ? '0.01' : group(Math.abs(value))}`
      if (value < 0.01) return `<${symbol}0.01`
      return `${symbol}${group(value)}`
    }

    /** @param {number} value @returns {string} */
    function group(value) {
      // The epsilon absorbs binary noise such as 8.23 * 100 = 822.9999…
      const floored = Math.floor(value * 100 + 1e-9) / 100
      return floored.toLocaleString(AMOUNT_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    /** @param {number} epochMs @returns {string} */
    function formatClockSeconds(epochMs) {
      return new Date(epochMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    }

    /** @param {string} key @param {object} error */
    function errorTitle(t, error) {
      const key = `err.${error?.code ?? 'fetch'}`
      const value = t(key)
      return value === key ? t('err.fetch') : value
    }

    // -----------------------------------------------------------------------
    // Hooks
    // -----------------------------------------------------------------------

    const MEASURE_STYLE = { position: 'fixed', left: 0, top: 0, visibility: 'hidden' }

    /**
     * Viewport-clamped placement above the trigger, with a below fallback when
     * there is no room. The panel measures itself while hidden, then shows.
     * @param {boolean} open
     */
    function useAnchoredPanel(open) {
      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const [pos, setPos] = React.useState(null)

      React.useLayoutEffect(() => {
        if (!open) {
          setPos(null)
          return
        }
        let frame = 0
        let observer = null
        const place = () => {
          const anchor = anchorRef.current
          const panel = panelRef.current
          if (anchor === null) return
          const rect = anchor.getBoundingClientRect()
          const panelRect = panel?.getBoundingClientRect()
          const width = panelRect?.width || 300
          const height = panelRect?.height || 0
          const margin = 12
          const gap = 8
          let left = rect.left + rect.width / 2 - width / 2
          left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))
          let top = rect.top - height - gap
          if (top < margin) top = rect.bottom + gap
          top = Math.max(margin, Math.min(top, window.innerHeight - height - margin))
          setPos({ left, top })
        }
        frame = window.requestAnimationFrame(place)
        if (typeof ResizeObserver === 'function' && panelRef.current !== null) {
          observer = new ResizeObserver(place)
          observer.observe(panelRef.current)
        }
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          window.cancelAnimationFrame(frame)
          observer?.disconnect()
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
      }, [open])

      return { anchorRef, panelRef, pos }
    }

    /** Close on Escape or a pointer press outside both trigger and panel. */
    function useDismiss(open, setOpen, anchorRef, panelRef) {
      React.useEffect(() => {
        if (!open) return
        const onPointerDown = (event) => {
          const target = event.target
          if (!(target instanceof Node)) return
          if (anchorRef.current?.contains(target) === true) return
          if (panelRef.current?.contains(target) === true) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open, setOpen, anchorRef, panelRef])
    }

    // -----------------------------------------------------------------------
    // Centered pill group (shared convention between the JaMoLpE88 pills)
    // -----------------------------------------------------------------------

    const CENTER_ATTR = 'data-dsh-center-pill'
    const CENTER_ORDER_ATTR = 'data-dsh-center-pill-order'
    const CENTER_GAP = 6
    const CENTER_MARGIN = 24

    /**
     * Center every composer pill of the same host as one group. Each pill is
     * absolutely positioned at 50%; this hook measures the visible siblings,
     * sorts them by `data-dsh-center-pill-order`, and offsets its own anchor so
     * the group stays centered with a small gap. It hides the group when it no
     * longer fits, and re-runs when a pill mounts, unmounts or changes width.
     *
     * @param {{ current: HTMLElement | null }} ref
     */
    function useCenterPills(ref) {
      React.useLayoutEffect(() => {
        const self = ref.current
        if (self === null) return
        const host = self.offsetParent
        if (host === null) return
        let frame = 0
        let resize = null

        const collect = () => Array.from(host.querySelectorAll(`[${CENTER_ATTR}]`))
          .filter((element) => element.offsetWidth > 0)
          .sort((left, right) => {
            const delta = Number(left.getAttribute(CENTER_ORDER_ATTR) ?? 0)
              - Number(right.getAttribute(CENTER_ORDER_ATTR) ?? 0)
            if (delta !== 0) return delta
            return (left.getAttribute(CENTER_ATTR) ?? '').localeCompare(right.getAttribute(CENTER_ATTR) ?? '')
          })

        const place = () => {
          frame = 0
          const pills = collect()
          const index = pills.indexOf(self)
          if (index < 0) return
          const widths = pills.map((element) => element.offsetWidth)
          const total = widths.reduce((sum, width) => sum + width, 0) + CENTER_GAP * (pills.length - 1)
          let before = 0
          for (let cursor = 0; cursor < index; cursor += 1) before += widths[cursor] + CENTER_GAP
          self.style.setProperty('--dsh-pill-shift', `${-total / 2 + before + widths[index] / 2}px`)
          const hidden = total > host.clientWidth - CENTER_MARGIN
          for (const element of pills) {
            if (hidden) element.setAttribute('data-dsh-pill-hidden', '')
            else element.removeAttribute('data-dsh-pill-hidden')
          }
        }

        const schedule = () => {
          if (frame !== 0) return
          frame = window.requestAnimationFrame(place)
        }

        const watch = () => {
          resize?.disconnect()
          resize = new ResizeObserver(schedule)
          resize.observe(host)
          for (const element of collect()) resize.observe(element)
        }

        const mutations = new MutationObserver((records) => {
          let relevant = false
          for (const record of records) {
            for (const node of [...record.addedNodes, ...record.removedNodes]) {
              if (node.nodeType !== 1) continue
              if (node.matches(`[${CENTER_ATTR}]`) || node.querySelector(`[${CENTER_ATTR}]`) !== null) {
                relevant = true
                break
              }
            }
            if (relevant) break
          }
          if (!relevant) return
          watch()
          schedule()
        })

        mutations.observe(host, { childList: true, subtree: true })
        watch()
        place()
        window.addEventListener('resize', schedule)
        return () => {
          window.cancelAnimationFrame(frame)
          window.removeEventListener('resize', schedule)
          mutations.disconnect()
          resize?.disconnect()
          self.style.removeProperty('--dsh-pill-shift')
        }
      }, [ref])
    }

    /**
     * Fetch the host snapshot only while the pill is visible. Manual refreshes
     * bypass the host cache; automatic ones use it.
     * @param {boolean} active
     */
    function useBalance(active) {
      const [view, setView] = React.useState(null)
      const [refreshing, setRefreshing] = React.useState(false)
      const activeRef = React.useRef(active)
      activeRef.current = active
      const busyRef = React.useRef(false)

      const load = React.useCallback(async (force) => {
        if (!activeRef.current || busyRef.current) return
        busyRef.current = true
        if (force) setRefreshing(true)
        try {
          const response = await fetch(force ? REFRESH_URL : VIEW_URL, {
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const next = await response.json()
          if (activeRef.current) setView(next)
        } catch {
          if (activeRef.current) {
            setView((previous) => previous === null
              ? {
                  updatedAt: null,
                  source: null,
                  currencies: null,
                  available: null,
                  error: { code: 'network', message: 'The local balance route did not answer.' },
                  stale: false,
                }
              : {
                  ...previous,
                  error: { code: 'network', message: 'The local balance route did not answer.' },
                  stale: previous.currencies !== null,
                })
          }
        } finally {
          busyRef.current = false
          setRefreshing(false)
        }
      }, [])

      React.useEffect(() => {
        if (!active) return
        load(false)
        const timer = window.setInterval(() => load(false), POLL_MS)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load(false)
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [active, load])

      const refresh = React.useCallback(() => {
        load(true)
      }, [load])

      return { view, refreshing, refresh }
    }

    /**
     * Read the provider of the model the composer shows. A blank Session has no
     * recorded selection until its first request, so fall back to the effective
     * default the model control displays for it.
     */
    function useProvider(props) {
      const selected = typeof props.useProjection === 'function'
        ? props.useProjection('modelSelection', (selection) => (selection?.next ?? selection?.lastUsed)?.provider)
        : undefined
      return useDisplayedProvider(props.models, props.sessionId) ?? selected
    }

    /**
     * Provider the composer's model control displays: the pending selection, the
     * used one, or the catalog default a new Session would send with.
     * @param {unknown} models the DSH model-directories service, when present
     * @param {string | undefined} sessionId
     */
    function useDisplayedProvider(models, sessionId) {
      const [provider, setProvider] = React.useState(undefined)
      React.useEffect(() => {
        setProvider(undefined)
        if (models === undefined || sessionId === undefined) return
        let store
        try {
          store = models.directoryFor(sessionId).store
        } catch {
          return
        }
        const read = () => setProvider(store.getSnapshot().current?.provider)
        read()
        return store.subscribe(read)
      }, [models, sessionId])
      return provider
    }

    // -----------------------------------------------------------------------
    // Icons
    // -----------------------------------------------------------------------

    const DEEPSEEK_VIEWBOX = '0.163 1.75 26.634 19.6'
    const DEEPSEEK_PATH = 'M26.5174 3.39471C26.235 3.2567 26.1137 3.52006 25.9487 3.65346C25.8923 3.69659 25.8446 3.75294 25.7969 3.80469C25.3846 4.24516 24.9027 4.53439 24.2737 4.49989C23.3536 4.44814 22.5682 4.73737 21.8735 5.44119C21.7258 4.57349 21.2353 4.0554 20.4889 3.72304C20.0985 3.55054 19.7034 3.37746 19.4297 3.00197C19.2388 2.73459 19.1865 2.43673 19.091 2.14289C19.0301 1.96579 18.9697 1.78466 18.7656 1.75418C18.5442 1.71968 18.4574 1.90541 18.3705 2.06067C18.0232 2.69549 17.8887 3.39471 17.9019 4.10313C17.9324 5.6965 18.6051 6.96556 19.9421 7.86834C20.0939 7.97184 20.133 8.07535 20.0852 8.22658C19.9938 8.53766 19.8857 8.83955 19.7903 9.15063C19.7293 9.34901 19.6384 9.39271 19.4257 9.30588C18.692 8.9994 18.0583 8.54571 17.4982 7.99772C16.5477 7.07827 15.6881 6.06336 14.6162 5.26869C14.3644 5.08296 14.1125 4.91045 13.8521 4.746C12.7584 3.68394 13.9952 2.81164 14.2816 2.70814C14.5812 2.60003 14.3857 2.22857 13.4179 2.23317C12.4502 2.2372 11.5646 2.56151 10.4359 2.99335C10.2708 3.05832 10.0972 3.10547 9.91951 3.14457C8.8954 2.95022 7.83162 2.90709 6.72069 3.03245C4.62877 3.26533 2.95777 4.25436 1.72954 5.94261C0.254043 7.97184 -0.0932678 10.2777 0.33167 12.6824C0.778458 15.2171 2.07225 17.3153 4.06008 18.9558C6.12152 20.6567 8.49577 21.4905 11.2047 21.3306C12.8498 21.2358 14.6812 21.0155 16.7473 19.2669C17.2682 19.5262 17.8151 19.6297 18.7219 19.7074C19.4205 19.7723 20.0933 19.6729 20.6143 19.5648C21.4302 19.3923 21.3739 18.6367 21.0789 18.4981C18.6874 17.3843 19.2124 17.8374 18.7351 17.4706C19.9501 16.033 21.8063 13.4776 22.379 9.99821C22.4353 9.61409 22.5072 9.073 22.4986 8.76192C22.494 8.57216 22.5377 8.49856 22.7545 8.47671C23.3536 8.40771 23.935 8.24383 24.4692 7.94999C26.0188 7.10357 26.6439 5.71318 26.7911 4.04678C26.8129 3.79204 26.7865 3.52869 26.5174 3.39471ZM13.0143 18.3946C10.6964 16.5724 9.5722 15.9726 9.10816 15.9985C8.67402 16.0244 8.75222 16.5212 8.84768 16.8449C8.94773 17.1646 9.07768 17.3849 9.25996 17.6655C9.38589 17.8512 9.47272 18.1272 9.13404 18.3348C8.38766 18.7965 7.08985 18.1796 7.0289 18.1491C5.51833 17.2595 4.25559 16.0853 3.36546 14.4793C2.50581 12.9337 2.0067 11.2753 1.92447 9.50542C1.90262 9.07818 2.02855 8.92695 2.45406 8.84932C3.01413 8.74582 3.59144 8.72397 4.15093 8.80619C6.51656 9.15178 8.53027 10.2092 10.2185 11.8848C11.1822 12.8388 11.9114 13.979 12.6623 15.0929C13.461 16.2757 14.3201 17.4027 15.4144 18.3268C15.8008 18.6505 16.109 18.8966 16.404 19.0783C15.5144 19.1778 14.0297 19.1991 13.0143 18.3958V18.3946ZM14.1252 11.2489C14.1252 11.0591 14.277 10.9079 14.4679 10.9079C14.511 10.9079 14.5501 10.9165 14.5852 10.9292C14.6329 10.9464 14.6766 10.9723 14.7111 11.0114C14.7721 11.0718 14.8066 11.158 14.8066 11.2489C14.8066 11.4386 14.6548 11.5899 14.4639 11.5899C14.273 11.5899 14.1252 11.4386 14.1252 11.2489ZM17.5759 13.0188C17.3545 13.1096 17.1331 13.1873 16.9203 13.1959C16.5903 13.2131 16.2303 13.0791 16.0348 12.9153C15.7312 12.6605 15.5139 12.5179 15.423 12.0734C15.3839 11.8837 15.4057 11.5899 15.4402 11.4214C15.5185 11.0585 15.4316 10.8257 15.1757 10.614C14.9676 10.4415 14.7025 10.3938 14.4115 10.3938C14.3029 10.3938 14.2034 10.3461 14.1292 10.3076C14.0079 10.2472 13.9078 10.096 14.0033 9.91023C14.0338 9.84985 14.1815 9.70322 14.216 9.67734C14.6111 9.45251 15.0665 9.52612 15.488 9.6946C15.8784 9.85445 16.174 10.1477 16.5989 10.5623C17.033 11.0631 17.1112 11.2011 17.3585 11.5772C17.554 11.871 17.7317 12.1729 17.8536 12.5185C17.9272 12.7341 17.8317 12.9107 17.5759 13.0188Z'

    function LogoBadge({ size = 16 }) {
      return h('svg', {
        className: 'dsb-logo',
        width: size,
        height: Math.round((size * 19.6) / 26.634),
        viewBox: DEEPSEEK_VIEWBOX,
        fill: 'currentColor',
        'aria-hidden': true,
      }, h('path', { d: DEEPSEEK_PATH }))
    }

    function GiftIcon({ size = 11 }) {
      return h('svg', {
        className: 'dsb-gift',
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      h('path', { d: 'M2.5 5.5h11v2h-11z' }),
      h('path', { d: 'M3.5 7.5v6h9v-6' }),
      h('path', { d: 'M8 5.5v8' }),
      h('path', { d: 'M8 5.5S7.4 2.5 5.8 2.5a1.4 1.4 0 0 0 0 3M8 5.5s.6-3 2.2-3a1.4 1.4 0 0 1 0 3' }))
    }

    function RefreshIcon({ size = 14, spinning = false }) {
      return h('svg', {
        className: spinning ? 'dsb-spin' : undefined,
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      h('path', { d: 'M13.2 6.4A5.4 5.4 0 1 0 13 11' }),
      h('path', { d: 'M13.5 3.4v3.2h-3.2' }))
    }

    function AlertIcon({ size = 14 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
      },
      h('circle', { cx: 8, cy: 8, r: 6 }),
      h('path', { d: 'M8 4.8v4' }),
      h('path', { d: 'M8 11.2v.1' }))
    }

    // -----------------------------------------------------------------------
    // Pieces
    // -----------------------------------------------------------------------

    /** One label/value row inside a currency block. */
    function Row({ label, value, strong = false }) {
      return h('div', { className: strong ? 'dsb-row dsb-row-strong' : 'dsb-row' },
        h('span', { className: 'dsb-row-label' }, label),
        h('span', { className: 'dsb-row-value' }, value))
    }

    /** One currency: topped-up, granted and total, zeros included. */
    function CurrencyBlock({ entry, t }) {
      return h('div', { className: 'dsb-currency' },
        h('div', { className: 'dsb-currency-code' }, entry.currency),
        h(Row, { label: t('row.toppedUp'), value: formatAmount(entry.toppedUp, entry.currency) }),
        h(Row, { label: t('row.granted'), value: formatAmount(entry.granted, entry.currency) }),
        h(Row, { label: t('row.total'), value: formatAmount(entry.total, entry.currency), strong: true }))
    }

    function ErrorBanner({ error, t }) {
      return h('div', { className: 'dsb-error', title: error.message },
        h('span', { className: 'dsb-error-icon' }, h(AlertIcon)),
        h('div', { className: 'dsb-error-copy' },
          h('div', { className: 'dsb-error-title' }, errorTitle(t, error)),
          h('div', { className: 'dsb-error-hint' }, t('err.hint'))))
    }

    /**
     * The currencies to show as a single total line: every currency with a
     * positive total, joined with ` + ` because currencies never add up.
     * @param {Array<{ currency: string, total: string }>} currencies
     */
    function summaryOf(currencies) {
      const positive = currencies.filter((entry) => Number(entry.total) > 0)
      if (positive.length === 0) return null
      return positive.map((entry) => formatAmount(entry.total, entry.currency)).join(' + ')
    }

    function Panel({ view, refreshing, onRefresh, t }) {
      const currencies = view?.currencies ?? null
      const error = view?.error ?? null
      const updated = typeof view?.updatedAt === 'number' ? view.updatedAt : null
      const entries = currencies ?? []
      const loading = view === null
      const summary = summaryOf(entries)
      const summaryDanger = !loading && (summary === null || view?.available === false)

      return h('div', { className: 'dsb-panel-body' },
        h('div', { className: 'dsb-panel-head' },
          h('span', { className: 'dsb-panel-title' },
            h(LogoBadge, { size: 16 }),
            t('panelTitle'))),
        h('div', { className: 'dsb-rule', 'aria-hidden': true }),
        error !== null ? h(ErrorBanner, { error, t }) : null,
        entries.length > 0
          ? h('div', { className: 'dsb-currencies' },
              entries.map((entry) => h(CurrencyBlock, { key: entry.currency, entry, t })))
          : null,
        h('div', { className: 'dsb-rule', 'aria-hidden': true }),
        h('div', { className: 'dsb-summary' },
          h('span', { className: 'dsb-summary-label' }, t('summary')),
          h('span', {
            className: summaryDanger ? 'dsb-summary-value dsb-danger' : 'dsb-summary-value',
            title: view?.available === false ? t('insufficient') : undefined,
          }, loading ? '—' : summary ?? t('noBalance'))),
        h('div', { className: 'dsb-rule', 'aria-hidden': true }),
        h('dl', { className: 'dsb-details' },
          h('dt', null, t('lastUpdated')),
          h('dd', null, updated !== null ? formatClockSeconds(updated) : '—'),
          h('dt', null, t('autoRefresh')),
          h('dd', null, t('everyMinute')),
          h('dt', null, t('source')),
          h('dd', null, view?.source === 'account' ? t('sourceAccount') : t('sourceApi')),
          view?.stale === true
            ? h(React.Fragment, { key: 'stale' },
                h('dt', null, t('refresh')),
                h('dd', null, t('staleValue')))
            : null),
        h('div', { className: 'dsb-actions' },
          h('a', {
            className: 'dsb-link',
            href: USAGE_URL,
            target: '_blank',
            rel: 'noreferrer noopener',
          }, t('usage')),
          h('a', {
            className: 'dsb-link',
            href: TOP_UP_URL,
            target: '_blank',
            rel: 'noreferrer noopener',
          }, t('topUp')),
          h('button', {
            type: 'button',
            className: 'dsb-refresh',
            disabled: refreshing,
            onClick: onRefresh,
          },
          h(RefreshIcon, { spinning: refreshing }),
          refreshing ? t('refreshing') : t('refresh'))))
    }

    /** The composer pill plus its portaled details dialog. */
    function BalancePill(props) {
      const t = translate(props)
      const provider = useProvider(props)
      const active = DEEPSEEK_PROVIDERS.has(provider)
      const { view, refreshing, refresh } = useBalance(active)
      const [open, setOpen] = React.useState(false)
      const { anchorRef, panelRef, pos } = useAnchoredPanel(open)
      useDismiss(open, setOpen, anchorRef, panelRef)
      useCenterPills(anchorRef)

      React.useEffect(() => {
        if (!active) setOpen(false)
      }, [active])

      if (!active) return null

      const currencies = view?.currencies ?? null
      const error = view?.error ?? null

      /** @type {Array<import('react').ReactNode>} */
      const parts = []
      let previous
      for (const entry of currencies ?? []) {
        const toppedUp = Number(entry.toppedUp)
        const granted = Number(entry.granted)
        if (!(toppedUp > 0) && !(granted > 0)) continue
        if (previous !== undefined) {
          parts.push(h('span', { key: `sep-${entry.currency}`, className: 'dsb-sep', 'aria-hidden': true }, '·'))
        }
        if (toppedUp > 0) {
          parts.push(h('span', { key: `${entry.currency}-topped`, className: 'dsb-pill-amount' },
            formatAmount(entry.toppedUp, entry.currency)))
        }
        if (granted > 0) {
          parts.push(h('span', { key: `${entry.currency}-granted`, className: 'dsb-pill-amount' },
            h(GiftIcon), formatAmount(entry.granted, entry.currency)))
        }
        previous = entry.currency
      }

      const summary = summaryOf(currencies ?? [])
      const aria = t('pill.aria', { summary: summary ?? t('noBalance') })

      const panel = open
        ? h('div', {
            ref: panelRef,
            className: 'dsb-panel',
            role: 'dialog',
            'aria-label': t('panelTitle'),
            style: pos === null ? MEASURE_STYLE : { position: 'fixed', left: pos.left, top: pos.top },
          },
          h(Panel, { view, refreshing, onRefresh: refresh, t }))
        : null

      return h('span', {
        ref: anchorRef,
        className: 'dsb-anchor',
        'data-dsb-anchor': '',
        'data-dsh-center-pill': 'deepseek-balance',
        'data-dsh-center-pill-order': '22',
      },
      h('button', {
        type: 'button',
        className: 'dsb-pill',
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-label': aria,
        title: t('panelTitle'),
        onClick: () => setOpen((value) => !value),
      },
      h(LogoBadge, { size: 16 }),
      parts.length > 0
        ? h('span', { className: 'dsb-pill-amounts' }, parts)
        : h('span', { className: 'dsb-pill-amounts dsb-pill-empty' },
            currencies !== null && currencies.length > 0
              ? formatAmount('0', currencies[0].currency)
              : '—'),
      error !== null
        ? h('span', {
            className: view?.stale === true ? 'dsb-dot dsb-dot-warn' : 'dsb-dot dsb-dot-err',
            'aria-hidden': true,
          })
        : null),
      panel !== null && createPortal !== null
        ? createPortal(panel, document.body)
        : panel)
    }

    // -----------------------------------------------------------------------
    // Styles
    // -----------------------------------------------------------------------

    const CSS = `
      [data-dsb-anchor] {
        position: absolute;
        left: 50%;
        bottom: 8px;
        transform: translateX(calc(-50% + var(--dsh-pill-shift, 0px)));
        transition: transform .18s ease;
        z-index: 20;
        display: inline-flex;
        pointer-events: auto;
      }
      [data-dsb-anchor][data-dsh-pill-hidden] {
        visibility: hidden;
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        [data-dsb-anchor] { transition: none; }
      }

      .dsb-logo {
        display: block;
        flex: none;
      }
      .dsb-gift {
        flex: none;
        opacity: .9;
      }

      .dsb-pill {
        height: calc(28px + var(--dsh-content-font-delta, 0px));
        border: 0;
        border-radius: var(--dsw-radius-sm);
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        font-family: inherit;
        font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 2px);
        font-variant-numeric: tabular-nums;
        line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
        white-space: nowrap;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 1px 4px;
      }
      .dsb-pill:hover,
      .dsb-pill[aria-expanded="true"] {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-secondary);
      }
      .dsb-pill:focus-visible {
        outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: 1px;
      }
      .dsb-pill-amounts { display: inline-flex; align-items: center; gap: 3px; }
      .dsb-pill-amount { display: inline-flex; align-items: center; gap: 2px; }
      .dsb-pill-empty { color: var(--dsw-alias-label-caption); }
      .dsb-sep {
        opacity: .7;
        line-height: 1;
        flex: none;
      }
      .dsb-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        flex: none;
      }
      .dsb-dot-err { background: var(--dsw-alias-state-error-primary); }
      .dsb-dot-warn { background: var(--dsw-alias-state-warn-primary); }

      .dsb-danger { color: var(--dsw-alias-state-error-primary); }

      .dsb-panel {
        position: fixed;
        z-index: 1100;
        box-sizing: border-box;
        width: min(264px, 100vw - 24px);
        max-height: min(72vh, 560px);
        overflow-y: auto;
        border: 0;
        border-radius: var(--dsw-radius-lg);
        background: var(--dsw-specific-menu);
        backdrop-filter: var(--dsw-menu-backdrop-filter);
        --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
        box-shadow: var(--dsw-elevation-prominent);
        color: var(--dsw-alias-label-secondary);
        cursor: default;
        padding: 12px;
        font-size: 12px;
        line-height: 20px;
      }
      .dsb-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 8px;
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
      }
      .dsb-panel-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .dsb-rule {
        border-top: .5px solid var(--dsw-alias-border-l2);
        margin-bottom: 10px;
      }
      .dsb-currencies {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 10px 0 12px;
      }
      .dsb-currency { display: flex; flex-direction: column; gap: 4px; }
      .dsb-currency-code {
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 20px;
      }
      .dsb-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .dsb-row-label { color: var(--dsw-alias-label-tertiary); }
      .dsb-row-value {
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
      }
      .dsb-row-strong .dsb-row-label { color: var(--dsw-alias-label-secondary); }
      .dsb-row-strong .dsb-row-value {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
      }
      .dsb-summary {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .dsb-summary-label {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
      }
      .dsb-summary-value {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .dsb-details {
        display: grid;
        grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
        gap: 6px 16px;
        margin: 0;
        color: var(--dsw-alias-label-tertiary);
      }
      .dsb-details dt,
      .dsb-details dd {
        margin: 0;
        min-width: 0;
      }
      .dsb-details dd {
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .dsb-error {
        display: flex;
        gap: 10px;
        margin: 10px 0;
        padding: 10px;
        border-radius: var(--dsw-radius-md);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
      }
      .dsb-error-icon {
        flex: none;
        color: var(--dsw-alias-state-error-primary);
        padding-top: 2px;
      }
      .dsb-error-copy { min-width: 0; }
      .dsb-error-title {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
        margin-bottom: 2px;
      }
      .dsb-error-hint {
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 18px;
      }
      .dsb-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: .5px solid var(--dsw-alias-border-l2);
      }
      .dsb-link,
      .dsb-refresh {
        border: 0;
        border-radius: var(--dsw-radius-sm);
        background: transparent;
        color: var(--dsw-alias-brand-primary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        text-decoration: none;
      }
      .dsb-link:hover,
      .dsb-refresh:hover:not(:disabled) {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dsb-refresh:disabled { opacity: .6; cursor: default; }
      .dsb-link:focus-visible,
      .dsb-refresh:focus-visible {
        outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: 1px;
      }
      .dsb-spin { animation: dsb-spin 1s linear infinite; }
      @keyframes dsb-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .dsb-spin { animation: none; }
      }
    `

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'deepseek-balance: dictionaries')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-deepseek-balance'
        style.dataset.pluginCss = 'dsh-deepseek-balance'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'deepseek-balance: styles')

      ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'deepseek-balance',
        order: 21,
        locale: NS,
        inject: () => ({ models: ctx.get('modelDirectories') }),
      }, BalancePill)), 'deepseek-balance: composer pill')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
