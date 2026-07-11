import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("server-renders the rota workspace directly", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(Date.now()));
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Gubei Prefect Toolkit/i);
  assert.match(html, /<h1[^>]*>Gubei Prefect Toolkit<\/h1>/i);
  assert.doesNotMatch(html, /landing page|learn more|codex-preview|cdn\.tailwindcss\.com/i);

  const assetDirectory = new URL("../dist/client/assets/", import.meta.url);
  const cssFiles = (await readdir(assetDirectory)).filter((file) => file.endsWith(".css"));
  const css = (await Promise.all(cssFiles.map((file) => readFile(new URL(file, assetDirectory), "utf8")))).join("\n");
  assert.match(css, /\.min-h-screen\{/);
  assert.match(css, /\.bg-black\{/);
});
