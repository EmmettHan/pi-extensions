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
| [`provider-balance`](extensions/provider-balance.ts) | Account balance for the active provider, in the footer |

---

## provider-balance

Shows the active provider's account balance in pi's footer, and hides itself
when the provider is unknown.

```
🦙 $24.75 / $60 · 已用 41% · 18天后重置 (12-14)     ollama.com
🐋 ¥14.23 可用                                      api.deepseek.com
```

Both lines use the same "spent" framing: the money is what the period has
consumed, so it agrees with the percentage instead of contradicting it. Ollama's
line colors by consumption — `dim` below 70%, `warning` from 70%, `error` from
90%.

### Supported providers

Detection is by the model's `baseUrl` **hostname**, not by a provider name:

| Host | Endpoint | Shown as |
|---|---|---|
| `ollama.com` | `GET /api/balance` | amount spent, percent used, reset date |
| `api.deepseek.com` | `GET /user/balance` | remaining prepaid balance |

Anything else stays hidden. Ollama Cloud needs a paid plan or purchased credits;
free accounts get a non-200 and see nothing, which is expected.

### Requirements

An **API key** for the provider, resolvable through pi's own credential chain
(`~/.pi/agent/auth.json` via `/login`, or the provider's environment variable).
The extension calls `ctx.modelRegistry.getApiKeyForProvider(ctx.model.provider)`
and never reads, writes, or logs the key itself.

### When it refreshes

| Event | Action |
|---|---|
| pi start, with a supported model active | fetch and show |
| `/model` switch to a supported provider | fetch and show |
| `/model` switch to anything else | hide |
| a user prompt is sent | fetch in the background |

There is no timer: an idle session makes no requests. Balance endpoints are free
but rate-limited (Ollama allows 10/minute per account), so the extension fetches
once per prompt — `before_agent_start` fires once per prompt, whereas
`turn_start` would repeat for every tool call — and honors `Retry-After` on a
429.

Fetches are fire-and-forget. They never block a model switch or a prompt, and a
network failure keeps the last known line rather than surfacing an error.

### Adding a provider

Append one object to `ADAPTERS` in
[`extensions/provider-balance.ts`](extensions/provider-balance.ts):

```ts
const example: Adapter = {
  host: "api.example.com",
  async line(ctx, key, signal) {
    const d = await getJson("https://api.example.com/balance", key, signal);
    if (!d?.remaining) return undefined;          // undefined hides the line
    return line(ctx, "dim", "◆", [`${d.remaining} left`]);
  },
};
```

`getJson` maps 429 to the shared backoff and any other failure to `undefined`.

### Limitations

- A local Ollama daemon is not supported: its `baseUrl` is `127.0.0.1`, so no
  adapter matches. Point pi at `ollama.com` directly.
- Ollama's `purchased` credits are not shown; only the plan allowance is.
- Providers without a public balance API cannot be supported (for example
  `cn.sidrune.ai`, which exposes none).

## License

MIT
