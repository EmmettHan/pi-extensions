# pi-extensions

Personal [pi](https://github.com/earendil-works/pi-mono) extensions. Each one is
small, single-purpose, and has no runtime dependencies.

## Install

```bash
pi install git:github.com/EmmettHan/pi-extensions
```

Or try one invocation without installing:

```bash
pi -e git:github.com/EmmettHan/pi-extensions
```

## Extensions

| Extension | What it does |
|---|---|
| [`ollama-balance`](extensions/ollama-balance.ts) | Ollama Cloud plan balance in the footer |

---

## ollama-balance

Shows the remaining Ollama Cloud plan credit in pi's footer:

```
🦙 $44.28 / $60 · 已用 26% · 19天后重置 (12-14)
```

The color follows consumption: `dim` below 70%, `warning` from 70%, `error`
from 90%.

### Requirements

- A provider whose `baseUrl` points at `ollama.com` (e.g. `https://ollama.com/v1`)
- An **API key** for that provider, resolvable through pi's own credential chain
  (`~/.pi/agent/auth.json` via `/login`, or `OLLAMA_API_KEY`)
- A **paid plan or purchased credits**. `GET /api/balance` is what the
  ollama.com settings page uses; free accounts get a non-200 and the extension
  stays silent — that is expected, not a bug.

The extension reads the key with
`ctx.modelRegistry.getApiKeyForProvider(ctx.model.provider)`, so it uses
whatever credential pi already has. It never writes or logs it.

### When it refreshes

| Event | Action |
|---|---|
| pi start, with an active model | fetch and show |
| `/model` switch to the provider | fetch and show |
| `/model` switch away | hide |
| a user prompt is sent | fetch in the background |

There is no timer: an idle session makes no requests. `/api/balance` costs
nothing but is rate-limited to 10 requests/minute per account, so the extension
fetches once per prompt (not once per turn — a turn with tool calls would
multiply requests) and honors `Retry-After` on a 429.

Fetches are fire-and-forget. They never block a model switch or a prompt, and a
network failure keeps the last known value instead of surfacing an error.

### Limitations

- The provider id is hardcoded to `ollama-cloud` in
  [`extensions/ollama-balance.ts`](extensions/ollama-balance.ts). If yours is
  named differently, change the `PROVIDER` constant.
- A local Ollama daemon is not supported: its `baseUrl` is `127.0.0.1` and older
  daemons do not proxy `/api/balance`. Point pi at `ollama.com` directly.
- `purchased` credits are not shown; only the plan allowance is.

## License

MIT
