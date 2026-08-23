import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST, runtime } from "../app/api/shared-history/route";
import { bearerCapability, hashEditCapability, hashedRequestNetwork, readValidatedPayload } from "./server/shared-history-http";

const originalEnabled = process.env.SHARED_HISTORY_ENABLED;
const originalSecret = process.env.RATE_LIMIT_SECRET;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.SHARED_HISTORY_ENABLED;
  else process.env.SHARED_HISTORY_ENABLED = originalEnabled;
  if (originalSecret === undefined) delete process.env.RATE_LIMIT_SECRET;
  else process.env.RATE_LIMIT_SECRET = originalSecret;
});

describe("shared history server contract", () => {
  it("uses the Node.js runtime and remains local-only while the feature flag is off", async () => {
    delete process.env.SHARED_HISTORY_ENABLED;

    expect(runtime).toBe("nodejs");
    await expect(GET(new Request("https://example.test/api/shared-history"))).resolves.toMatchObject({ status: 404 });
    await expect(POST(new Request("https://example.test/api/shared-history", { method: "POST" }))).resolves.toMatchObject({ status: 404 });
  });

  it("accepts only a 256-bit base64url bearer capability and hashes it before storage", () => {
    const token = "a".repeat(43);
    const request = new Request("https://example.test", { headers: { authorization: `Bearer ${token}` } });

    expect(bearerCapability(request)).toBe(token);
    expect(hashEditCapability(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(bearerCapability(new Request("https://example.test", { headers: { authorization: "Bearer short" } }))).toBeNull();
  });

  it("hashes the trusted network header with a private HMAC secret", () => {
    process.env.RATE_LIMIT_SECRET = "s".repeat(32);
    const request = new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "203.0.113.10" },
    });

    const hashed = hashedRequestNetwork(request);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("203.0.113.10");
  });

  it("ships retention, cap, and rate-limit enforcement in the database contract", () => {
    const migration = readFileSync("db/migrations/001_shared_history.sql", "utf8");
    const database = readFileSync("src/server/shared-history-db.ts", "utf8");

    expect(migration).toContain("edit_token_hash CHAR(64)");
    expect(database).toContain("interval '90 days'");
    expect(database).toContain("OFFSET 200");
    expect(database).toContain("<= 30");
  });

  it("rejects request bodies above 64 KB before parsing them", async () => {
    const response = await readValidatedPayload(new Request("https://example.test", {
      method: "POST",
      body: "x".repeat(65 * 1024),
    }));

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.response.status).toBe(413);
  });
});
