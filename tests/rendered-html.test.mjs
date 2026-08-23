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

const jpegDimensions = (buffer) => {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = buffer.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions not found");
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
  assert.equal(metaContent(html, "property", "og:image"), "http://localhost/og.jpg");
  assert.equal(metaContent(html, "name", "twitter:card"), "summary_large_image");
  assert.equal(metaContent(html, "name", "twitter:title"), "Gubei Prefect Toolkit");
  assert.equal(
    metaContent(html, "name", "twitter:description"),
    "Build balanced SUIS Gubei prefect room rotas quickly.",
  );
  assert.equal(metaContent(html, "name", "twitter:image"), "http://localhost/og.jpg");

  const authorityCases = [
    {
      label: "malformed forwarded authority",
      headers: { host: "safe.example", "x-forwarded-host": "bad host" },
      image: "https://safe.example/og.jpg",
    },
    {
      label: "userinfo-bearing forwarded authority",
      headers: { host: "safe.example:8443", "x-forwarded-host": "victim.example@evil.example" },
      image: "https://safe.example:8443/og.jpg",
    },
    {
      label: "bracketed IPv6 loopback with port",
      headers: { host: "[::1]:8787" },
      image: "http://[::1]:8787/og.jpg",
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

  assert.match(html, /<h1[^>]*>Rota Generator<\/h1>/i);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.doesNotMatch(html, /Editorial campus duty desk|校园值勤排布台/i);
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
    /grid-template-areas:\s*\n\s*"brief rail"\s*\n\s*"selection rail"\s*\n\s*"restore restore"/,
  );
  assert.match(sourceCss, /\.restore-sheet\s*\{\s*grid-area:\s*restore;/);
  assert.match(sourceCss, /\.setup-main\s*\{\s*display:\s*contents;/);
  assert.match(sourceCss, /\.setup-rail\s*\{[\s\S]*?grid-area:\s*rail;/);
  assert.match(
    sourceCss,
    /@media \(min-width: 880px\)[\s\S]*grid-template-areas:\s*\n\s*"brief brief"\s*\n\s*"selection selection"\s*\n\s*"rail rail"\s*\n\s*"restore restore"/,
  );
  assert.match(sourceCss, /grid-template-areas:\s*\n\s*"brief"\s*\n\s*"selection"\s*\n\s*"rail"\s*\n\s*"restore"/);

  const mobileStart = sourceCss.indexOf("@media (max-width: 720px)");
  const mobileEnd = sourceCss.indexOf("@media (prefers-reduced-motion", mobileStart);
  assert.ok(mobileStart >= 0 && mobileEnd > mobileStart);
  const mobileCss = sourceCss.slice(mobileStart, mobileEnd);
  assert.match(mobileCss, /\.people-sheet\s*\{[\s\S]*?padding:\s*18px;/);
  assert.match(mobileCss, /\.people-sheet \.prefect-groups\s*\{[\s\S]*?gap:\s*8px;/);
  assert.match(mobileCss, /\.people-sheet \.prefect-group\s*\{[\s\S]*?padding-top:\s*7px;/);
  assert.match(mobileCss, /\.people-sheet \.prefect-list\s*\{[\s\S]*?margin-top:\s*2px;/);
  assert.match(
    mobileCss,
    /\.prefect-row\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?flex-direction:\s*row;[\s\S]*?gap:\s*8px;[\s\S]*?padding:\s*2px 0;/,
  );
  assert.match(
    mobileCss,
    /\.prefect-choice\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?width:\s*auto;/,
  );
  assert.match(
    mobileCss,
    /\.double-choice\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*auto;[\s\S]*?justify-content:\s*flex-end;[\s\S]*?white-space:\s*nowrap;/,
  );
  assert.doesNotMatch(mobileCss, /\.prefect-row\s*\{[^}]*flex-direction:\s*column;/);

  const socialImage = await readFile(new URL("../dist/client/og.jpg", import.meta.url));
  assert.deepEqual([...socialImage.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(socialImage.byteLength <= 250_000);
  const dimensions = jpegDimensions(socialImage);
  assert.deepEqual(dimensions, { width: 1200, height: 630 });
});
