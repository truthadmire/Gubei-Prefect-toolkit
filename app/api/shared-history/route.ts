import {
  cleanSharedHistory,
  consumeMutationQuota,
  createSharedHistory,
  decodeFeedCursor,
  listSharedHistory,
} from "../../../src/server/shared-history-db";
import {
  bearerCapability,
  hashEditCapability,
  hashedRequestNetwork,
  json,
  readValidatedPayload,
  sharedHistoryEnabled,
  unavailableResponse,
} from "../../../src/server/shared-history-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!sharedHistoryEnabled()) return unavailableResponse();
  try {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 50;
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length > 80) return json({ error: "invalid_query" }, { status: 400 });
    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor ? decodeFeedCursor(rawCursor) : undefined;
    const page = await listSharedHistory({ limit, cursor, query });
    return json(page, {
      headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid-cursor") {
      return json({ error: "invalid_cursor" }, { status: 400 });
    }
    return json({ error: "service_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sharedHistoryEnabled()) return unavailableResponse();
  const capability = bearerCapability(request);
  if (!capability) return json({ error: "unauthorized" }, { status: 401 });
  const networkHash = hashedRequestNetwork(request);
  if (!networkHash) return json({ error: "rate_limit_unavailable" }, { status: 503 });

  try {
    const payload = await readValidatedPayload(request);
    if (!payload.ok) return payload.response;
    if (!await consumeMutationQuota(networkHash)) {
      return json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "3600" } });
    }
    const item = await createSharedHistory(payload.value, hashEditCapability(capability));
    if (!item) return json({ error: "conflict" }, { status: 409 });
    await cleanSharedHistory();
    return json({ item }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch {
    return json({ error: "service_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
