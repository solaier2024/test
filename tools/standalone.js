// Inline Vite's production JS/CSS. Media and the GLB stay in the progressive
// manifest; HTMLPreview resolves public/assets from the raw GitHub URL.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("dist");
let html = (await readFile(resolve(root, "index.html"), "utf8")).replace(
  /\r\n/g,
  "\n",
);
const scripts = [
  ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g),
];
for (const match of scripts) {
  const js = await readFile(resolve(root, match[1]), "utf8");
  html = html.replace(
    match[0],
    () =>
      `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
}
const styles = [
  ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g),
];
for (const match of styles) {
  const css = await readFile(resolve(root, match[1]), "utf8");
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
const favicon = await readFile("public/favicon.svg", "utf8");
html = html.replace(
  /href="\.\/favicon.svg"/,
  () =>
    `href="data:image/svg+xml;base64,${Buffer.from(favicon).toString("base64")}"`,
);
await writeFile(
  resolve(root, "standalone.html"),
  html.replace(
    "<head>",
    '<head><meta name="penalty-asset-path" content="assets/">',
  ),
);
await writeFile(
  "standalone.html",
  html.replace(
    "<head>",
    '<head><meta name="penalty-asset-path" content="public/assets/">',
  ),
);
console.log("Built dist/standalone.html and repository HTMLPreview entry");
