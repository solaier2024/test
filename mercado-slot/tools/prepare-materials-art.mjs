import sharp from "sharp";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const [atlas, bottle, sign] = process.argv.slice(2);
if (!atlas || !bottle || !sign)
  throw new Error("Provide the selected atlas, bottle and sign PNGs.");
const directory = "mercado-slot/public/art";
const work = ".asset-work/mercado-materials-v3";
await mkdir(work, { recursive: true });
for (const [name, source] of [
  ["food-source.png", atlas],
  ["bottle-source.png", bottle],
  ["sign-source.png", sign],
])
  await copyFile(source, `${work}/${name}`);

const manifest = JSON.parse(
  await readFile(`${directory}/manifest.json`, "utf8"),
);
for (const asset of manifest.assets)
  if (
    ["food-atlas.webp", "brand-sign-v2.webp", "salsa-bottle-v2.webp"].includes(
      asset.file,
    )
  )
    asset.critical = false;

// Deterministic atlas packing only: retain the generated pixels/alpha, crop
// each equal cell, fit its silhouette, and give all frames identical padding.
const sheet = await sharp(atlas).resize(2048, 1024).png().toBuffer();
const cells = [];
for (let i = 0; i < 8; i++) {
  const extracted = await sharp(sheet)
    .extract({
      left: (i % 4) * 512,
      top: Math.floor(i / 4) * 512,
      width: 512,
      height: 512,
    })
    .png()
    .toBuffer();
  const image = await sharp(extracted)
    .trim({ threshold: 8 })
    .resize(432, 432, { fit: "inside" })
    .png()
    .toBuffer();
  const info = await sharp(image).metadata();
  cells.push({
    input: image,
    left: (i % 4) * 512 + Math.floor((512 - info.width) / 2),
    top: Math.floor(i / 4) * 512 + Math.floor((512 - info.height) / 2),
  });
}
const packed = await sharp({
  create: {
    width: 2048,
    height: 1024,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(cells)
  .png()
  .toBuffer();

for (const [file, source, size, quality, trim, critical] of [
  ["food-atlas-v3.webp", packed, { width: 1024 }, 88, false, true],
  ["food-atlas-full-v3.webp", packed, { width: 2048 }, 90, false, false],
  ["salsa-bottle-v3.webp", bottle, { height: 960 }, 88, true, true],
  ["brand-sign-v3.webp", sign, { width: 768 }, 88, true, true],
]) {
  let pipeline = sharp(source);
  if (trim) pipeline = pipeline.trim({ threshold: 8 });
  const bytes = await pipeline
    .resize(size)
    .webp({ quality, alphaQuality: 100 })
    .toBuffer();
  const meta = await sharp(bytes).metadata();
  if (!meta.hasAlpha) throw new Error(`Missing alpha: ${file}`);
  await writeFile(`${directory}/${file}`, bytes);
  manifest.assets = manifest.assets.filter((asset) => asset.file !== file);
  manifest.assets.push({
    file,
    bytes: bytes.length,
    width: meta.width,
    height: meta.height,
    alpha: true,
    critical,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  `${directory}/manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    manifest.assets.filter((asset) => asset.file.includes("v3")),
    null,
    2,
  ),
);
