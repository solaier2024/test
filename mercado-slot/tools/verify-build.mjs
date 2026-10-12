import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import sharp from "sharp";

const directory = "dist-mercado";
const manifest = JSON.parse(
  await readFile("mercado-slot/public/art/manifest.json", "utf8"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let artBytes = 0,
  criticalArtBytes = 0;
for (const asset of manifest.assets) {
  const bytes = await readFile(`${directory}/art/${asset.file}`);
  assert.equal(bytes.length, asset.bytes, asset.file);
  assert.equal(hash(bytes), asset.sha256, asset.file);
  const info = await sharp(bytes).metadata();
  assert.equal(info.width, asset.width);
  assert.equal(info.height, asset.height);
  assert.equal(info.hasAlpha, asset.alpha);
  artBytes += bytes.length;
  if (asset.critical !== false) criticalArtBytes += bytes.length;
}
const media = JSON.parse(
  await readFile(`${directory}/media/manifest.json`, "utf8"),
);
assert.equal(media.version, 1);
assert.equal(media.reviewed, true, "Videos must be reviewed before shipping");
let mediaBytes = 0;
const videos = [];
for (const name of [
  "landscape-environment",
  "portrait-environment",
  "opening-cinematic",
]) {
  const asset = media.assets[name];
  assert(asset, name);
  assert(/^[a-z-]+\.mp4$/.test(asset.file));
  const bytes = await readFile(`${directory}/media/${asset.file}`);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(hash(bytes), asset.sha256);
  assert(bytes.length <= 2_000_000, "Progressive movie budget");
  assert.equal(bytes.toString("ascii", 4, 8), "ftyp");
  // Top-level ISO-BMFF boxes: the index must precede samples for progressive playback.
  const boxes = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    assert(
      size >= 8 && offset + size <= bytes.length,
      `Invalid MP4 box ${type}`,
    );
    boxes.push(type);
    offset += size;
  }
  assert(boxes.includes("moov") && boxes.includes("mdat"));
  assert(
    boxes.indexOf("moov") < boxes.indexOf("mdat"),
    "Fast-start moov required",
  );
  assert(bytes.includes(Buffer.from("avc1")), "H.264 decoder path");
  assert.equal(
    bytes.includes(Buffer.from("mp4a")),
    asset.hasAudio,
    "AAC track matches manifest",
  );
  assert.equal(asset.fps, 24);
  assert(asset.duration > 0 && asset.duration <= 6);
  assert.equal(
    asset.width,
    name === "portrait-environment"
      ? 720
      : name === "opening-cinematic"
        ? 1920
        : 1280,
  );
  assert.equal(
    asset.height,
    name === "portrait-environment"
      ? 1280
      : name === "opening-cinematic"
        ? 1080
        : 720,
  );
  videos.push({
    role: name,
    bytes: bytes.length,
    width: asset.width,
    height: asset.height,
    duration_seconds: asset.duration,
    has_audio: asset.hasAudio,
  });
  mediaBytes += bytes.length;
}
const audio = [];
for (const [role, asset] of [
  ["ambience", media.audio],
  ["music", media.music],
]) {
  assert(asset, `Missing ${role} asset`);
  assert(/^[a-z-]+\.m4a$/.test(asset.file));
  const bytes = await readFile(`${directory}/media/${asset.file}`);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(hash(bytes), asset.sha256);
  assert(bytes.length <= 1_000_000, "Progressive audio budget");
  assert.equal(bytes.toString("ascii", 4, 8), "ftyp");
  assert(bytes.includes(Buffer.from("mp4a")), "AAC decoder path");
  assert(asset.duration > 0 && asset.duration <= 65);
  audio.push({ role, bytes: bytes.length, duration_seconds: asset.duration });
  mediaBytes += bytes.length;
}
assert.equal(
  media.music.licenseUrl,
  "https://creativecommons.org/licenses/by/4.0/",
);
let scriptAndCssGzip = 0,
  fontBytes = 0;
for (const file of await readdir(`${directory}/assets`)) {
  const bytes = await readFile(`${directory}/assets/${file}`);
  if (/\.(js|css)$/.test(file)) scriptAndCssGzip += gzipSync(bytes).length;
  if (/\.woff2$/.test(file)) fontBytes += bytes.length;
}
const standalone = await readFile(`${directory}/standalone.html`, "utf8");
const repositoryExport = await readFile("mercado-slot/standalone.html", "utf8");
assert(
  !standalone.includes("QA-ONLY") && !standalone.includes("INTERNAL QA"),
  "Fixture controls must be excluded from production",
);
assert(standalone.includes('meta name="mercado-art"'));
assert(standalone.includes('meta name="mercado-public-path" content="./"'));
assert(
  repositoryExport.includes(
    'meta name="mercado-public-path" content="public/"',
  ),
);
assert(!/<script[^>]+src=/.test(standalone));
assert(standalone.indexOf('<div id="app"') < standalone.indexOf("<script>"));
assert(!standalone.includes("new URL(`../art/"));
assert(standalone.includes("data:font/woff2;base64,"));
// Pixi contains a tiny WebM codec capability probe; game MP4s stay external.
assert(
  !standalone.includes("data:video/mp4"),
  "Game video must remain progressive, never base64",
);
const embedded = JSON.parse(
  standalone
    .match(/meta name="mercado-art" content="([^"]+)"/)[1]
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&"),
);
assert.deepEqual(
  Object.keys(embedded).sort(),
  manifest.assets
    .filter((a) => a.critical !== false)
    .map((a) => a.file)
    .sort(),
);
assert(scriptAndCssGzip <= 250_000, "JS + CSS gzip budget");
assert(
  scriptAndCssGzip + criticalArtBytes + fontBytes <= 1_200_000,
  "Critical transfer budget",
);
assert(
  scriptAndCssGzip + artBytes + fontBytes <= 8_000_000,
  "Complete non-video budget",
);
const report = {
  status: "PASS",
  script_and_css_gzip_bytes: scriptAndCssGzip,
  art_bytes: artBytes,
  critical_art_bytes: criticalArtBytes,
  fonts_woff2_bytes: fontBytes,
  production_critical_transfer_bytes:
    scriptAndCssGzip + criticalArtBytes + fontBytes,
  progressive_media_bytes: mediaBytes,
  videos,
  audio,
  standalone_bytes: Buffer.byteLength(standalone),
  standalone_gzip_bytes: gzipSync(standalone).length,
  renderer:
    "PixiJS WebGL; Lite DPR <= 1.5, Full DPR <= 2; 15 food sprites + 15 motion ghosts + 32 pooled particles",
  media_policy:
    "One HTMLVideoElement/decoder; orientation swap; forward loop dissolve; pause when hidden; posters on failure",
  audio_policy:
    "One streamed AAC music element + 12-second grill buffer; no note scheduler; music pauses for CG, mute and hidden tabs; separate ambience and effects gains",
  scope:
    "Build and asset budgets; physical mobile FPS and memory are not certified",
};
await writeFile(
  "mercado-slot/docs/build-report.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
