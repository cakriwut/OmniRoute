const USAGE_LIMIT = /^you have reached your specified api usage limits\b/i;
const USAGE_RESET = /\bwill regain access on (\d{4}-\d{2}-\d{2})(?: at (\d{2}:\d{2}) UTC)?\b/i;
const MAX_PAUSE_MS = 30 * 24 * 60 * 60 * 1000;

/** Account-level billing responses from custom gateways, not generic 400/403 failures. */
export function classifyCompatibleAccountQuota(
  status: number,
  provider: string | null | undefined,
  text: string,
  nowMs = Date.now()
): { cooldownMs: number; creditsExhausted: boolean } | null {
  if (status !== 400 && status !== 403) return null;
  if (!provider || !/^(?:openai|anthropic)-compatible-/.test(provider)) return null;

  const prefix = status === 400 ? /^\[400\]:\s*/ : /^\[403\]:\s*/;
  let message = text.trim().replace(prefix, "");
  if (message.startsWith("{")) {
    try {
      const body = JSON.parse(message);
      if (typeof body?.error?.message !== "string") return null;
      message = body.error.message.trim().replace(prefix, "");
    } catch {
      return null;
    }
  }

  if (status === 400 && /^your credit balance is too low to access the anthropic api\b/i.test(message)) {
    return { cooldownMs: 0, creditsExhausted: true };
  }
  if (status === 400 && USAGE_LIMIT.test(message)) {
    const reset = USAGE_RESET.exec(message);
    const waitMs = reset ? Date.parse(`${reset[1]}T${reset[2] ?? "00:00"}:00Z`) - nowMs : 0;
    return {
      cooldownMs: waitMs > 0 ? Math.min(waitMs, MAX_PAUSE_MS) : 60 * 60 * 1000,
      creditsExhausted: false,
    };
  }
  if (
    status === 403 &&
    /^the free quota has been exhausted\b/i.test(message) &&
    /complete your payment information|use free tier only/i.test(message)
  ) {
    return { cooldownMs: 0, creditsExhausted: true };
  }
  return null;
}
