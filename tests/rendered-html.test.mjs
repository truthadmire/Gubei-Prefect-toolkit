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
  assert.match(html, /<h1[^>]*>Prefect Rota<\/h1>/i);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.doesNotMatch(html, /landing page|learn more|codex-preview|cdn\.tailwindcss\.com/i);

  const assetDirectory = new URL("../dist/client/assets/", import.meta.url);
  const cssFiles = (await readdir(assetDirectory)).filter((file) => file.endsWith(".css"));
  const css = (await Promise.all(cssFiles.map((file) => readFile(new URL(file, assetDirectory), "utf8")))).join("\n");
  assert.match(css, /\.min-h-screen\{/);
  assert.match(css, /\.bg-black\{/);
  assert.match(css, /--canvas:\s*#f3eddf/i);
  assert.match(css, /--cobalt:\s*#2452d4/i);
  assert.match(css, /\.sheet\{/);

  const sourceCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(sourceCss, /@media \(min-width: 1180px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 328px/);
  assert.match(
    sourceCss,
    /grid-template-areas:\s*\n\s*"brief restore"\s*\n\s*"selection rail"/,
  );
  assert.match(sourceCss, /\.restore-sheet\s*\{\s*grid-area:\s*restore;/);
  assert.match(sourceCss, /\.setup-main\s*\{\s*display:\s*contents;/);
  assert.match(sourceCss, /\.setup-rail\s*\{[\s\S]*?grid-area:\s*rail;/);
  assert.match(
    sourceCss,
    /@media \(min-width: 880px\)[\s\S]*grid-template-areas:\s*\n\s*"brief brief"\s*\n\s*"selection selection"\s*\n\s*"restore rail"/,
  );
  assert.match(
    sourceCss,
    /@media \(max-width: 720px\)[\s\S]*\.prefect-choice,\s*\n\s*\.double-choice,\s*\n\s*\.grade-group__heading label\s*\{[\s\S]*?min-height:\s*44px;/,
  );
});
