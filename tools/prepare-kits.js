// Adapt Kenney's editable CC0 SVG skin into football kits, then rasterize UV maps.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
const source = await readFile(
  new URL("../public/assets/models/kit-source.svg", import.meta.url),
  "utf8",
);
for (const [name, base, trim, number] of [
  ["athlete", "#b7e766", "#709e3e", "1"],
  ["striker", "#168b80", "#11675e", "9"],
]) {
  let svg = source.replace(
    "<svg ",
    '<svg width="1024" height="1024" viewBox="0 0 1024 1024" ',
  );
  svg = svg
    .replace(/#(F85F48|EF3E31|EA3031)/gi, base)
    .replace(/#195C86/gi, "#29443e")
    .replace(/#124163/gi, "#182b25");
  svg = svg.replace(
    "</svg>",
    `<rect x="148" y="491" width="360" height="530" fill="${base}"/><path d="M151 510H506M151 965H506" stroke="${trim}" stroke-width="12"/><path d="M300 500h55l-8 24h-39z" fill="${trim}"/><text x="328" y="880" font-family="Arial" font-weight="900" font-size="90" text-anchor="middle" fill="#eef8e9">${number}</text></svg>`,
  );
  await writeFile(
    new URL(`../public/assets/models/${name}-kit.svg`, import.meta.url),
    svg,
  );
  await sharp(Buffer.from(svg))
    .png()
    .toFile(
      new URL(
        `../public/assets/models/${name}.png`,
        import.meta.url,
      ).pathname.replace(/^\/(\w:)/, "$1"),
    );
}
