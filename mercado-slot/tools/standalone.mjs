import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("dist-mercado");
let html = await readFile(resolve(root, "index.html"), "utf8");
const art = {};
for (const name of ["food-atlas.webp", "market.webp"])
  art[name] =
    `data:image/webp;base64,${(await readFile(resolve(root, "art", name))).toString("base64")}`;
for (const match of [
  ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g),
]) {
  let js = await readFile(resolve(root, match[1]), "utf8");
  // Vite 8's single IIFE emits CSS via JS and resolves CSS URLs against the
  // script location. Replace those references for the inline preview export.
  for (const name of Object.keys(art)) {
    const expression =
      "new URL(`../art/" +
      name +
      "`,document.currentScript&&document.currentScript.tagName.toUpperCase()===`SCRIPT`&&document.currentScript.src||document.baseURI).href";
    if (!js.includes(expression))
      throw new Error(`Missing built CSS art reference: ${name}`);
    js = js.replaceAll(
      expression,
      `JSON.parse(document.querySelector('meta[name="mercado-art"]').content)[${JSON.stringify(name)}]`,
    );
  }
  for (const name of await readdir(resolve(root, "assets"))) {
    if (!/\.woff2?$/.test(name)) continue;
    const bytes = await readFile(resolve(root, "assets", name));
    const type = name.endsWith(".woff2") ? "font/woff2" : "font/woff";
    js = js.replaceAll(
      "`" + name + "`",
      "`data:" + type + ";base64," + bytes.toString("base64") + "`",
    );
  }
  // Classic IIFE works in HTMLPreview too; put it after #app so a normal
  // browser cannot execute this export before its mount point exists.
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
  for (const image of Object.keys(art))
    css = css.replaceAll(`./art/${image}`, art[image]);
  const fonts = [
    ...new Set(
      [...css.matchAll(/url\(([^)]+\.(?:woff2?|webp))\)/g)].map((m) =>
        m[1].replace(/^['"]|['"]$/g, ""),
      ),
    ),
  ];
  for (const font of fonts) {
    const bytes = await readFile(resolve(root, font));
    const type = font.endsWith(".woff2") ? "font/woff2" : "font/woff";
    css = css.replaceAll(
      font,
      `data:${type};base64,${bytes.toString("base64")}`,
    );
  }
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
// Inject before the game script, so its progressive asset loader sees the data.
html = html.replace(
  "<head>",
  `<head><meta name="mercado-art" content="${JSON.stringify(art).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`,
);
await writeFile(resolve(root, "standalone.html"), html);
await writeFile("mercado-slot/standalone.html", html);
console.log(
  `Built self-contained Mercado preview (${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB).`,
);
