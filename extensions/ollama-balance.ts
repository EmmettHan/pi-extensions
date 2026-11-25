/**
 * ollama-balance — Ollama Cloud plan balance in the pi footer.
 *
 *   🦙 $44.30 / $60 · 已用 26% · 19天后重置 (12-14)
 *
 * Shows only while an `ollama-cloud` model is active. Refreshes once per user
 * message (before_agent_start, messageType "user"), never on a timer, so an
 * idle session makes zero requests. `GET /api/balance` costs nothing but is
 * rate-limited to 10 req/min per account: `before_agent_start` fires once per
 * prompt (unlike turn_start, which fires again for every tool call), and a 429
 * backs off for the server's Retry-After.
 *
 * The key comes from pi's own credential chain, so changing it in auth.json
 * updates this too. Failures keep the last known value instead of erroring.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROVIDER = "ollama-cloud";
const STATUS_ID = "ollama-balance";
const DAY_MS = 86_400_000;

interface Balance {
	included: { balance_usd: number; allowance_usd: number; period?: { until?: string } };
}

/** Last payload, kept so a theme change or a failed refresh still repaints. */
let last: Balance | null = null;
let retryAfter = 0;
let inflight = false;

const isActive = (ctx: ExtensionContext) => ctx.model?.provider === PROVIDER;

const usd = (n: number, cents = false) =>
	cents || n % 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`;

function render(ctx: ExtensionContext, b: Balance): string {
	const { balance_usd: bal, allowance_usd: allow, period } = b.included;
	const pct = allow > 0 ? ((allow - bal) / allow) * 100 : 0;
	const tone = pct >= 90 ? "error" : pct >= 70 ? "warning" : "dim";

	const parts = [`${usd(bal, true)} / ${usd(allow)}`, `已用 ${Math.round(pct)}%`];
	const until = period?.until ? new Date(period.until) : null;
	if (until && !Number.isNaN(until.getTime())) {
		const days = Math.max(0, Math.floor((until.getTime() - Date.now()) / DAY_MS));
		const md = `${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}`;
		parts.push(`${days}天后重置 (${md})`);
	}
	return ctx.ui.theme.fg(tone, `🦙 ${parts.join(" · ")}`);
}

function paint(ctx: ExtensionContext): void {
	if (last) ctx.ui.setStatus(STATUS_ID, render(ctx, last));
}

async function refresh(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI || inflight || Date.now() < retryAfter) return;
	inflight = true;
	try {
		const key = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
		if (!key) {
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("warning", "🦙 未配置 key"));
			return;
		}
		const res = await fetch("https://ollama.com/api/balance", {
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(8000),
		});
		if (res.status === 429) {
			const secs = Number(res.headers.get("retry-after"));
			retryAfter = Date.now() + (Number.isFinite(secs) && secs > 0 ? secs : 60) * 1000;
			return;
		}
		if (!res.ok) return;
		last = (await res.json()) as Balance;
		paint(ctx);
	} catch {
		// Network failure: keep the last known value rather than showing an error.
	} finally {
		inflight = false;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (isActive(ctx)) void refresh(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		if (event.model.provider === PROVIDER) void refresh(ctx);
		else ctx.ui.setStatus(STATUS_ID, undefined);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user" || !isActive(ctx)) return;
		void refresh(ctx);
	});
}
