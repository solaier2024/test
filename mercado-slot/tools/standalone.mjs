import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("dist-mercado");
let html = await readFile(resolve(root, "index.html"), "utf8");
const manifest = JSON.parse(
  await readFile(resolve(root, "art/manifest.json"), "utf8"),
);
const art = {};
for (const asset of manifest.assets.filter(
  (asset) => asset.critical !== false,
)) {
  art[asset.file] =
    `data:image/webp;base64,${(await readFile(resolve(root, "art", asset.file))).toString("base64")}`;
}
const builtAssets = await readdir(resolve(root, "assets"));
for (const match of [
  ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g),
]) {
  let js = await readFile(resolve(root, match[1]), "utf8");
  // Vite's IIFE resolves CSS URLs from its script. Inline critical art and
  // fonts; optional atlases and video retain the same pinned public base.
  for (const name of Object.keys(art)) {
    const expression =
      "new URL(`../art/" +
      name +
      "`,document.currentScript&&document.currentScript.tagName.toUpperCase()===`SCRIPT`&&document.currentScript.src||document.baseURI).href";
    js = js.replaceAll(
      expression,
      `JSON.parse(document.querySelector('meta[name="mercado-art"]').content)[${JSON.stringify(name)}]`,
    );
  }
  if (js.includes("new URL(`../art/"))
    throw new Error("Unresolved standalone CSS art");
  for (const name of builtAssets.filter((name) => /\.woff2?$/.test(name))) {
    const bytes = await readFile(resolve(root, "assets", name));
    const type = name.endsWith(".woff2") ? "font/woff2" : "font/woff";
    js = js.replaceAll(
      "`" + name + "`",
      "`data:" + type + ";base64," + bytes.toString("base64") + "`",
    );
  }
  html = html.replace(match[0], "");
  html = html.replace(
    "</body>",
    () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script></body>`,
  );
}
for (const match of [
  ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g),
]) {
  let css = await readFile(resolve(root, match[1]), "utf8");
  for (const [name, uri] of Object.entries(art))
    css = css
      .replaceAll(`./art/${name}`, uri)
      .replaceAll(`../art/${name}`, uri);
  for (const path of new Set(
    [...css.matchAll(/url\(([^)]+\.woff2?)\)/g)].map((m) =>
      m[1].replace(/^['"]|['"]$/g, ""),
    ),
  )) {
    const bytes = await readFile(resolve(root, path));
    css = css.replaceAll(
      path,
      `data:font/${path.endsWith(".woff2") ? "woff2" : "woff"};base64,${bytes.toString("base64")}`,
    );
  }
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
const serialized = JSON.stringify(art)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;");
const exportHtml = (publicPath) =>
  html.replace(
    "<head>",
    `<head><meta name="mercado-public-path" content="${publicPath}"><meta name="mercado-art" content="${serialized}">`,
  );
await writeFile(resolve(root, "standalone.html"), exportHtml("./"));
await writeFile("mercado-slot/standalone.html", exportHtml("public/"));
console.log(
  `Built Mercado preview (${(Buffer.byteLength(exportHtml("public/")) / 1024).toFixed(0)} KiB; videos and Full atlas load progressively).`,
);
