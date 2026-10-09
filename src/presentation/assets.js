export function assetBase() {
  const prefix =
    document.querySelector('meta[name="penalty-asset-path"]')?.content ??
    "assets/";
  // Preserve the user's existing HTMLPreview link as well as normal Pages/Vite.
  const query =
    location.hostname === "htmlpreview.github.io"
      ? decodeURIComponent(location.search.slice(1))
      : "";
  if (
    location.hostname === "htmlpreview.github.io" &&
    /^https:\/\/raw\.githubusercontent\.com\/.+\/standalone\.html$/.test(query)
  ) {
    return new URL(prefix, query).href;
  }
  return new URL(prefix, document.baseURI).href;
}
export const assetUrl = (path) => new URL(path, assetBase()).href;

export async function loadFonts() {
  const fonts = [
    ["Barlow", "barlow", 500],
    ["Barlow", "barlow", 600],
    ["Barlow", "barlow", 700],
    ["Barlow Condensed", "barlow-condensed", 800],
    ["Barlow Condensed", "barlow-condensed", 900],
  ];
  await Promise.allSettled(
    fonts.map(async ([family, file, weight]) => {
      const face = new FontFace(
        family,
        `url("${assetUrl(`fonts/${file}-latin-${weight}-normal.woff2`)}")`,
        { weight: String(weight), display: "swap" },
      );
      document.fonts.add(face);
      await face.load();
    }),
  );
}

export async function loadManifest() {
  const response = await fetch(assetUrl("media-manifest.json"));
  if (!response.ok) throw new Error("场景资源清单加载失败");
  const manifest = await response.json();
  if (manifest.version !== 1 || !manifest.models?.athlete)
    throw new Error("资源清单版本不支持");
  return manifest;
}

export function mediaVariant(entry, portrait) {
  return (
    entry?.[portrait ? "portrait" : "landscape"] ?? entry?.landscape ?? null
  );
}
