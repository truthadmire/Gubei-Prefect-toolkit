import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel deployment contract", () => {
  it("builds the App Router with the native Next.js preset", () => {
    const configPath = resolve(process.cwd(), "vercel.json");

    expect(
      existsSync(configPath),
      "vercel.json must override the stale Vite project preset",
    ).toBe(true);

    if (!existsSync(configPath)) return;

    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      framework?: string;
      buildCommand?: string;
    };

    expect(config.framework).toBe("nextjs");
    expect(config.buildCommand).toBe("next build");
  });
});
