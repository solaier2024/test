import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
const directory = "dist-mercado";
const manifest = JSON.parse(
  await readFile("mercado-slot/public/art/manifest.json", "utf8"),
);
let artBytes = 0;
for (const asset of manifest.assets) {
  const content = await readFile(`${directory}/art/${asset.file}`);
  assert.equal(content.length, asset.bytes);
  assert.equal(
    createHash("sha256").update(content).digest("hex"),
    asset.sha256,
  );
  const info = await sharp(content).metadata();
  assert.equal(info.width, asset.width);
  assert.equal(info.height, asset.height);
  assert.equal(info.hasAlpha, asset.alpha);
  artBytes += content.length;
}
let scriptAndCssGzip = 0,
  fontBytes = 0;
for (const file of await readdir(`${directory}/assets`)) {
  const content = await readFile(`${directory}/assets/${file}`);
  if (/\.(js|css)$/.test(file)) scriptAndCssGzip += gzipSync(content).length;
  if (/\.woff2$/.test(file)) fontBytes += content.length;
}
const standalone = await readFile(`${directory}/standalone.html`, "utf8");
assert(standalone.includes('meta name="mercado-art"'));
assert(!/<script[^>]+src=/.test(standalone));
assert(standalone.indexOf('<div id="app"') < standalone.indexOf("<script>"));
assert(!standalone.includes("new URL(`../art/"));
assert(standalone.includes("data:font/woff2;base64,"));
assert(scriptAndCssGzip <= 250_000);
assert(scriptAndCssGzip + artBytes + fontBytes <= 1_200_000);
const report = {
  status: "PASS",
  script_and_css_gzip_bytes: scriptAndCssGzip,
  art_bytes: artBytes,
  fonts_woff2_bytes: fontBytes,
  production_critical_transfer_bytes: scriptAndCssGzip + artBytes + fontBytes,
  standalone_bytes: Buffer.byteLength(standalone),
  standalone_gzip_bytes: gzipSync(standalone).length,
  renderer: "PixiJS WebGL; DPR capped at 1.5; 15 recycled food sprites",
  scope:
    "Build and asset budgets; physical mobile FPS and memory are not certified",
};
await writeFile(
  "mercado-slot/docs/build-report.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
