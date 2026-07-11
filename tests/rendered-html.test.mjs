import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const decodeHtml = (value) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const tagAttributes = (tag) => {
  const attributes = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4]);
  }
  return attributes;
};

const metaContent = (html, selector, value) => {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if (attributes[selector] === value) return attributes.content;
  }
  return undefined;
};

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
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  assert.equal(decodeHtml(title?.[1] ?? ""), "Gubei Prefect Toolkit");
  assert.equal(
    metaContent(html, "name", "description"),
    "Build balanced SUIS Gubei prefect room rotas quickly.",
  );
  assert.equal(metaContent(html, "property", "og:title"), "Gubei Prefect Toolkit");
  assert.equal(
    metaContent(html, "property", "og:description"),
    "Build balanced SUIS Gubei prefect room rotas quickly.",
  );
  assert.equal(metaContent(html, "property", "og:type"), "website");
  assert.equal(metaContent(html, "property", "og:image"), "http://localhost/og.png");
  assert.equal(metaContent(html, "name", "twitter:card"), "summary_large_image");
  assert.equal(metaContent(html, "name", "twitter:title"), "Gubei Prefect Toolkit");
  assert.equal(
    metaContent(html, "name", "twitter:description"),
    "Build balanced SUIS Gubei prefect room rotas quickly.",
  );
  assert.equal(metaContent(html, "name", "twitter:image"), "http://localhost/og.png");

  const authorityCases = [
    {
      label: "malformed forwarded authority",
      headers: { host: "safe.example", "x-forwarded-host": "bad host" },
      image: "https://safe.example/og.png",
    },
    {
      label: "userinfo-bearing forwarded authority",
      headers: { host: "safe.example:8443", "x-forwarded-host": "victim.example@evil.example" },
      image: "https://safe.example:8443/og.png",
    },
    {
      label: "bracketed IPv6 loopback with port",
      headers: { host: "[::1]:8787" },
      image: "http://[::1]:8787/og.png",
    },
  ];
  for (const authorityCase of authorityCases) {
    const authorityResponse = await worker.fetch(
      new Request("http://localhost/", {
        headers: { accept: "text/html", ...authorityCase.headers },
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(authorityResponse.status, 200, authorityCase.label);
    const authorityHtml = await authorityResponse.text();
    assert.equal(
      metaContent(authorityHtml, "property", "og:image"),
      authorityCase.image,
      authorityCase.label,
    );
  }

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

  const socialImage = await readFile(new URL("../dist/client/og.png", import.meta.url));
  assert.deepEqual(
    [...socialImage.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(socialImage.subarray(12, 16).toString("ascii"), "IHDR");
  const socialImageWidth = socialImage.readUInt32BE(16);
  const socialImageHeight = socialImage.readUInt32BE(20);
  assert.ok(socialImageWidth > 0);
  assert.ok(socialImageHeight > 0);
  assert.ok(Math.abs(socialImageWidth / socialImageHeight - 1200 / 630) < 0.05);
});
