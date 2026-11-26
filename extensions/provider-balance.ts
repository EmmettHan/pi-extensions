/**
 * provider-balance — cloud account balance for the active provider, in pi's
 * footer. Shows only while a model served by a known provider is active.
 *
 *   🦙 $22.33 / $60 · 已用 37% · 18天后重置 (12-14)   ollama.com
 *   🐋 ¥14.23 可用                                    api.deepseek.com
 *
 * Adding a provider means appending one object to ADAPTERS: match the model's
 * baseUrl hostname and return the finished line. Nothing else changes.
 *
 * Refreshes once per user prompt (before_agent_start, messageType "user"),
 * never on a timer, so an idle session makes zero requests. Balance endpoints
 * are free but rate-limited, and before_agent_start fires once per prompt
 * unlike turn_start, which repeats for every tool call. A 429 backs off for
 * the server's Retry-After.
 *
 * Fetches are fire-and-forget: they never block a model switch or a prompt,
 * and a failure keeps the last known line instead of surfacing an error. The
 * key comes from pi's credential chain, so it is never read from disk here.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "provider-balance";
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 8000;

type Tone = "dim" | "warning" | "error";

interface Adapter {
	/** Hostname of the API origin that serves the balance endpoint. */
	host: string;
	/** Build the footer line, or undefined to hide it. */
	line(ctx: ExtensionContext, key: string, signal: AbortSignal): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class RateLimited extends Error {
	constructor(readonly retryAfterMs: number) {
		super("rate limited");
	}
}

const usd = (n: number, cents = false) => (cents || n % 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`);

const money = (currency: string, n: number) =>
	`${currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `}${n.toFixed(2)}`;

const tone = (pct: number): Tone => (pct >= 90 ? "error" : pct >= 70 ? "warning" : "dim");

const line = (ctx: ExtensionContext, t: Tone, icon: string, parts: string[]) =>
	ctx.ui.theme.fg(t, `${icon} ${parts.join(" · ")}`);

/** GET JSON, mapping 429 to RateLimited and other failures to undefined. */
async function getJson(url: string, key: string, signal: AbortSignal): Promise<any> {
	const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal });
	if (res.status === 429) {
		const secs = Number(res.headers.get("retry-after"));
		throw new RateLimited((Number.isFinite(secs) && secs > 0 ? secs : 60) * 1000);
	}
	return res.ok ? res.json() : undefined;
}

// ---------------------------------------------------------------------------
// Adapters — one per provider API. Append here to support another provider.
// ---------------------------------------------------------------------------

const ollama: Adapter = {
	host: "ollama.com",
	async line(ctx, key, signal) {
		const d = await getJson("https://ollama.com/api/balance", key, signal);
		const i = d?.included;
		if (typeof i?.allowance_usd !== "number" || typeof i?.balance_usd !== "number") return undefined;

		const used = i.allowance_usd - i.balance_usd;
		const pct = i.allowance_usd > 0 ? (used / i.allowance_usd) * 100 : 0;
		const parts = [`${usd(used, true)} / ${usd(i.allowance_usd)}`, `已用 ${Math.round(pct)}%`];

		const until = i.period?.until ? new Date(i.period.until) : null;
		if (until && !Number.isNaN(until.getTime())) {
			const days = Math.max(0, Math.floor((until.getTime() - Date.now()) / DAY_MS));
			const md = `${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}`;
			parts.push(`${days}天后重置 (${md})`);
		}
		return line(ctx, tone(pct), "🦙", parts);
	},
};

const deepseek: Adapter = {
	host: "api.deepseek.com",
	async line(ctx, key, signal) {
		const d = await getJson("https://api.deepseek.com/user/balance", key, signal);
		const info = d?.balance_infos?.[0];
		const total = Number(info?.total_balance);
		if (!Number.isFinite(total)) return undefined;
		return line(ctx, "dim", "🐋", [`${money(info.currency, total)} 可用`]);
	},
};

const ADAPTERS: Adapter[] = [ollama, deepseek];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let retryAfter = 0;
let inflight = false;

function hostOf(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) return undefined;
	try {
		return new URL(baseUrl).hostname;
	} catch {
		return undefined;
	}
}

const activeAdapter = (ctx: ExtensionContext) => {
	const host = hostOf(ctx.model?.baseUrl);
	return host ? ADAPTERS.find((a) => a.host === host) : undefined;
};

async function refresh(ctx: ExtensionContext): Promise<void> {
	const adapter = activeAdapter(ctx);
	if (!ctx.hasUI || !adapter || inflight || Date.now() < retryAfter) return;
	inflight = true;
	try {
		const key = await ctx.modelRegistry.getApiKeyForProvider(ctx.model!.provider);
		if (!key) {
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("warning", "未配置 key"));
			return;
		}
		const text = await adapter.line(ctx, key, AbortSignal.timeout(TIMEOUT_MS));
		if (text) ctx.ui.setStatus(STATUS_ID, text);
	} catch (error) {
		// RateLimited sets the backoff; anything else keeps the last known line.
		if (error instanceof RateLimited) retryAfter = Date.now() + error.retryAfterMs;
	} finally {
		inflight = false;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (activeAdapter(ctx)) void refresh(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		if (activeAdapter(ctx)) void refresh(ctx);
		else ctx.ui.setStatus(STATUS_ID, undefined);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user" || !activeAdapter(ctx)) return;
		void refresh(ctx);
	});
}
