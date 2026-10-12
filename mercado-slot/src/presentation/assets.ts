// HTMLPreview rewrites relative sources. A standalone export embeds its exact
// own small art bundle; normal Vite builds use the public/art directory.
export function assetUrl(path: "food-atlas.webp" | "market.webp") {
  const embedded = document.querySelector<HTMLMetaElement>(
    'meta[name="mercado-art"]',
  );
  if (embedded) {
    const manifest = JSON.parse(embedded.content) as Record<string, string>;
    if (manifest[path]) return manifest[path]!;
  }
  return `${import.meta.env.BASE_URL}art/${path}`;
}
