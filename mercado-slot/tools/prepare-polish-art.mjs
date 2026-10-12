import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const [logo, bottle, fullAtlas] = process.argv.slice(2);
if (!logo || !bottle || !fullAtlas)
  throw new Error("Provide logo, bottle and original full atlas paths.");
const directory = "mercado-slot/public/art";
const manifest = JSON.parse(
  await readFile(`${directory}/manifest.json`, "utf8"),
);
for (const [file, input, size, trim] of [
  ["brand-sign-v2.webp", logo, { width: 768 }, true],
  ["salsa-bottle-v2.webp", bottle, { height: 960 }, true],
  ["food-atlas-full.webp", fullAtlas, { width: 1776 }, false],
]) {
  let pipeline = sharp(input);
  if (trim) pipeline = pipeline.trim({ threshold: 5 });
  const bytes = await pipeline
    .resize(size)
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer();
  const meta = await sharp(bytes).metadata();
  if (!meta.hasAlpha) throw new Error("Missing alpha " + file);
  await writeFile(`${directory}/${file}`, bytes);
  const asset = {
    file,
    bytes: bytes.length,
    width: meta.width,
    height: meta.height,
    alpha: true,
    critical: file !== "food-atlas-full.webp",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  manifest.assets = manifest.assets.filter((a) => a.file !== file);
  manifest.assets.push(asset);
}
await writeFile(
  `${directory}/manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest.assets, null, 2));
