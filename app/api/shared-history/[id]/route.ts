import {
  cleanSharedHistory,
  consumeMutationQuota,
  updateSharedHistory,
} from "../../../../src/server/shared-history-db";
import {
  bearerCapability,
  hashEditCapability,
  hashedRequestNetwork,
  json,
  readValidatedPayload,
  sharedHistoryEnabled,
  unavailableResponse,
} from "../../../../src/server/shared-history-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sharedHistoryEnabled()) return unavailableResponse();
  const capability = bearerCapability(request);
  if (!capability) return json({ error: "unauthorized" }, { status: 401 });
  const networkHash = hashedRequestNetwork(request);
  if (!networkHash) return json({ error: "rate_limit_unavailable" }, { status: 503 });

  try {
    const { id } = await context.params;
    const payload = await readValidatedPayload(request);
    if (!payload.ok) return payload.response;
    if (payload.value.id !== id) return json({ error: "id_mismatch" }, { status: 400 });
    if (!await consumeMutationQuota(networkHash)) {
      return json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "3600" } });
    }
    const item = await updateSharedHistory(id, payload.value, hashEditCapability(capability));
    if (!item) return json({ error: "not_found" }, { status: 404 });
    await cleanSharedHistory();
    return json({ item }, { headers: { "cache-control": "no-store" } });
  } catch {
    return json({ error: "service_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
