import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const [atlasInput, backgroundInput] = process.argv.slice(2);
if (!atlasInput || !backgroundInput)
  throw new Error("Pass the two generated image paths.");
const directory = fileURLToPath(new URL("../public/art/", import.meta.url));
await mkdir(directory, { recursive: true });
const input = await sharp(atlasInput).metadata();
if (input.width !== input.height * 2 || !input.hasAlpha)
  throw new Error("Atlas must be 2:1 with alpha.");
const assets = [];
for (const [name, source, width, quality] of [
  ["food-atlas.webp", atlasInput, 1024, 88],
  ["market.webp", backgroundInput, 1600, 78],
]) {
  const bytes = await sharp(source)
    .resize({ width })
    .webp({ quality, alphaQuality: 100 })
    .toBuffer();
  await writeFile(`${directory}/${name}`, bytes);
  const info = await sharp(bytes).metadata();
  assets.push({
    file: name,
    bytes: bytes.length,
    width: info.width,
    height: info.height,
    alpha: info.hasAlpha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  `${directory}/manifest.json`,
  `${JSON.stringify({ generator: "built-in image_gen", assets }, null, 2)}\n`,
);
console.log(JSON.stringify(assets, null, 2));
