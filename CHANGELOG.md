# Changelog

All notable changes to `@jamolpe88/dsh-deepseek-balance` are documented here.

## 0.1.1 — 2026-10-27

- The pill joins the shared centered pill group used by the other JaMoLpE88 composer plugins (OpenCode Go usage and DeepSeek rate clock). Several visible pills sit side by side, centered, with a small gap; they hide together when the composer cannot fit them, instead of overlapping the model selector.
- README positioning notes updated. No other runtime changes.

## 0.1.0 — 2026-10-27

- First release.
- Shows the DeepSeek Platform balance in the composer: one amount per currency with a balance, the granted part marked with a gift icon.
- Amounts always use a dot decimal separator and a comma for thousands, like the DeepSeek Platform site, whatever the browser language.
- Click opens a DSH-style details dialog with topped-up, granted and total balance per currency, the combined total, last update, automatic 60-second refresh, the data source and the official Usage and Top up links.
- Provider-aware visibility: the pill renders only while a DeepSeek model (`deepseek-official` or `deepseek-account`) is selected, including the empty New Session hero before its first prompt.
- Zero configuration: reads the `DEEPSEEK_API_KEY` credential DSH already holds, and falls back to the signed-in DeepSeek account when no key exists.
- Host-side 55-second cache, request deduplication and a stale-data fallback after failures.
- No settings page, no config file, no stored secrets and no browser access to the API key.
- No expiry countdown: no reachable DeepSeek endpoint exposes the granted balance's expiry date.
