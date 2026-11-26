# Changelog

## [0.2.0] - 2026-11-25

- Rename `ollama-balance` to `provider-balance` and make it adapter-based: a
  provider is one entry in an `ADAPTERS` table, matched by the active model's
  `baseUrl` hostname.
- Add DeepSeek (`GET /user/balance`), shown as `🐋 ¥14.23 可用`.

## [0.1.0] - 2026-11-25

- Add `ollama-balance`: Ollama Cloud plan balance in the pi footer.
