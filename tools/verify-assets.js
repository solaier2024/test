import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import assert from "node:assert/strict";
import { selectShotClip } from "../src/presentation/video-match.js";
import { choreography } from "../src/presentation/choreography.js";

// HTMLPreview reinjects module tags as classic scripts.
const html = await readFile("standalone.html", "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length > 0);
for (const [index, script] of scripts.entries())
  new Script(script[1], { filename: `standalone-script-${index}.js` });
const manifest = JSON.parse(
  await readFile("public/assets/media-manifest.json", "utf8"),
);
assert.equal(manifest.version, 2);
assert.equal(manifest.gameplay.presentation, "video");
const paths = new Set(manifest.loading.critical);
const variants = [
  ...Object.values(manifest.cinematics),
  manifest.gameplay.idle,
];
const resolutions = ["attack", "defend"].flatMap((phase) =>
  ["L", "C", "R"].flatMap((dir) =>
    [true, false].map((success) => ({ phase, dir, success, shot: "placed" })),
  ),
);
for (const [key, entry] of Object.entries(manifest.gameplay.shots)) {
  // Pending/rejected assets are never shipped as approved clips.
  assert.equal(
    entry.status,
    "approved",
    `Unreviewed shot in production manifest: ${key}`,
  );
  variants.push(entry);
  for (const portrait of [false, true]) {
    const sample = Object.values(entry).find(
      (v) => v && typeof v === "object" && v.src,
    );
    const resolution = resolutions.find((r) => {
      const plan = choreography(r);
      return (
        plan.ballDir === sample.ballDir &&
        plan.diveDir === sample.diveDir &&
        plan.saved === sample.saved
      );
    });
    assert.ok(resolution, `Unreachable shot mapping: ${key}`);
    const clip = selectShotClip(manifest, resolution, portrait);
    assert.equal(clip?.key, key, `Mismatched outcome clip: ${key}`);
  }
}
for (const entry of variants)
  for (const clip of Object.values(entry))
    if (clip && typeof clip === "object" && clip.src) {
      paths.add(clip.src);
      paths.add(clip.poster);
      assert.ok(clip.duration > 0 && clip.width > 0 && clip.height > 0);
    }
for (const clip of Object.values(manifest.audio)) {
  assert.equal(clip.license, "CC0-1.0");
  paths.add(clip.src);
}
if (manifest.gameplay.shotPackStatus === "complete") {
  if (manifest.gameplay.crowdMotionRequired) {
    assert.equal(
      manifest.gameplay.idle.crowdMotion,
      "approved",
      "Static stadium loop",
    );
    for (const entry of Object.values(manifest.gameplay.shots))
      assert.equal(
        entry.crowdMotion,
        "approved",
        "Static spectators in action footage",
      );
  }
  for (const resolution of resolutions)
    for (const portrait of [false, true])
      assert.ok(
        selectShotClip(manifest, resolution, portrait),
        "Incomplete action pack",
      );
}
for (const path of paths) {
  assert.ok(
    !path.includes("..") && !path.startsWith("/"),
    "Assets must stay under public/assets",
  );
  assert.ok((await readFile(`public/assets/${path}`)).length > 0);
}
console.log(
  `Classic standalone scripts, ${paths.size} media resources and ${Object.keys(manifest.gameplay.shots).length}/7 action mappings verified; dynamic crowd ${Object.values(manifest.gameplay.shots).filter((entry) => entry.crowdMotion === "approved").length}/7, idle ${manifest.gameplay.idle.crowdMotion}`,
);
