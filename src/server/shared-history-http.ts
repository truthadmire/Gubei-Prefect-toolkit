import { createHash, createHmac } from "node:crypto";
import rosterJson from "../../public/roster.json";
import type { RosterJson } from "../types";
import { MAX_SHARED_HISTORY_BODY_BYTES, validateSharedHistoryPayload } from "../lib/shared-history-validation";
import type { SharedHistoryPayload } from "../lib/shared-history-client";

export const currentRoster = rosterJson as RosterJson;

export function sharedHistoryEnabled(): boolean {
  return process.env.SHARED_HISTORY_ENABLED === "true";
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function unavailableResponse(): Response {
  return json({ error: "not_available" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export function bearerCapability(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  return match?.[1] || null;
}

export function hashEditCapability(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashedRequestNetwork(request: Request): string | null {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) return null;
  const forwarded = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-real-ip");
  const network = forwarded?.split(",", 1)[0]?.trim();
  if (!network || network.length > 128) return null;
  return createHmac("sha256", secret).update(network).digest("hex");
}

export async function readValidatedPayload(
  request: Request,
): Promise<{ ok: true; value: SharedHistoryPayload } | { ok: false; response: Response }> {
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SHARED_HISTORY_BODY_BYTES) {
    return { ok: false, response: json({ error: "payload_too_large" }, { status: 413 }) };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: json({ error: "invalid_body" }, { status: 400 }) };
  }
  if (new TextEncoder().encode(text).byteLength > MAX_SHARED_HISTORY_BODY_BYTES) {
    return { ok: false, response: json({ error: "payload_too_large" }, { status: 413 }) };
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, { status: 400 }) };
  }
  const validated = await validateSharedHistoryPayload(input, currentRoster);
  if (!validated.ok) {
    return { ok: false, response: json({ error: "invalid_payload", field: validated.reason }, { status: 400 }) };
  }
  return validated;
}
