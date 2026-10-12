// HTMLPreview rewrites relative sources. A standalone export embeds its exact
// own small art bundle; normal Vite builds use the public/art directory.
let embeddedArt: Record<string, string> | null = null;
export function publicBase(): string {
  const prefix =
    document.querySelector<HTMLMetaElement>('meta[name="mercado-public-path"]')
      ?.content ?? "./";
  if (location.hostname === "htmlpreview.github.io") {
    try {
      const source = decodeURIComponent(location.search.slice(1));
      if (
        /^https:\/\/raw\.githubusercontent\.com\/[^?#]+\/standalone\.html$/.test(
          source,
        )
      )
        return new URL(prefix, source).href;
    } catch {
      /* Fall back to the document base. */
    }
  }
  return new URL(prefix, document.baseURI).href;
}
export function assetUrl(path: string) {
  const embedded = document.querySelector<HTMLMetaElement>(
    'meta[name="mercado-art"]',
  );
  if (embedded) {
    embeddedArt ??= JSON.parse(embedded.content) as Record<string, string>;
    if (embeddedArt[path]) return embeddedArt[path]!;
  }
  return new URL(`art/${path}`, publicBase()).href;
}
export const mediaUrl = (path: string) =>
  new URL(`media/${path}`, publicBase()).href;
