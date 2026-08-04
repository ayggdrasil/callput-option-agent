import { createHash } from "node:crypto";

export const TELEMETRY_EVENTS = [
  "app_view",
  "scan_success",
  "transaction_prepared",
  "wallet_confirmed",
  "onchain_detected",
  "keeper_executed",
  "cancelled"
] as const;

export type TelemetryEvent = typeof TELEMETRY_EVENTS[number];

export function anonymousWalletId(address?: string): string | undefined {
  if (!address) return undefined;
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex").slice(0, 20);
}

export async function captureTelemetry(input: {
  event: TelemetryEvent;
  distinctId: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
}): Promise<void> {
  const properties = Object.fromEntries(
    Object.entries(input.properties ?? {}).filter(([, value]) => value !== undefined)
  );
  const key = process.env.POSTHOG_KEY;
  const host = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/$/, "");

  if (!key) {
    console.info(JSON.stringify({ type: "callput_telemetry", event: input.event, distinct_id: input.distinctId, properties }));
    return;
  }

  const response = await fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, event: input.event, distinct_id: input.distinctId, properties }),
    signal: AbortSignal.timeout(2_500)
  });
  if (!response.ok) throw new Error(`Telemetry capture failed: HTTP ${response.status}`);
}
