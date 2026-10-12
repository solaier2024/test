import assert from "node:assert/strict";
import { test } from "node:test";
import { MarketMedia } from "../src/presentation/media.ts";

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Video extends EventTarget {
  playsInline = false;
  preload = "";
  poster = "";
  src = "";
  paused = true;
  muted = true;
  loop = false;
  volume = 1;
  readyState = 4;
  dataset: Record<string, string> = {};
  plays: ReturnType<typeof deferred>[] = [];
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  play() {
    this.paused = false;
    const attempt = deferred();
    this.plays.push(attempt);
    return attempt.promise;
  }
}
async function setup() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["window", "document", "matchMedia", "location", "fetch"];
  const originals = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  globals["window"] = { addEventListener() {}, removeEventListener() {} };
  globals["document"] = {
    hidden: false,
    baseURI: "https://unit.test/",
    querySelector: () => null,
  };
  globals["location"] = { hostname: "unit.test" };
  globals["matchMedia"] = () => ({ matches: false });
  globals["fetch"] = async () => ({
    ok: true,
    json: async () => ({
      version: 1,
      reviewed: true,
      assets: {
        "landscape-environment": {
          file: "market-landscape.mp4",
          bytes: 441097,
          duration: 5.5,
        },
        "portrait-environment": {
          file: "market-portrait.mp4",
          bytes: 323359,
          duration: 5.5,
        },
        "opening-cinematic": {
          file: "opening.mp4",
          bytes: 1036004,
          duration: 4,
        },
      },
    }),
  });
  const video = new Video(),
    classes = new Set<string>();
  const stage = {
    classList: {
      add: (value: string) => classes.add(value),
      remove: (value: string) => classes.delete(value),
    },
    style: { setProperty() {} },
  };
  const media = new MarketMedia(
    video as unknown as HTMLVideoElement,
    stage as unknown as HTMLElement,
  );
  await media.init();
  return {
    media,
    video,
    classes,
    close: () => {
      media.dispose();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globals[key];
      }
    },
  };
}
test("an aborted background play must not hide a decoded, playing CG", async () => {
  const fixture = await setup();
  try {
    const oldBackground = fixture.video.plays[0]!;
    const opening = fixture.media.opening();
    fixture.video.plays[1]!.resolve();
    fixture.video.dispatchEvent(new Event("playing"));
    oldBackground.reject(new Error("AbortError: source switched"));
    await Promise.resolve();
    await Promise.resolve();
    assert(fixture.classes.has("cinematic"));
    assert(fixture.classes.has("video-playing"), "The CG must remain visible");
    assert.equal(fixture.video.dataset["state"], "opening");
    assert(fixture.video.src.endsWith("/opening.mp4"));
    fixture.media.skip();
    await opening;
  } finally {
    fixture.close();
  }
});
test("an aborted environment attempt cannot mark the re-enabled environment as failed", async () => {
  const fixture = await setup();
  try {
    const oldBackground = fixture.video.plays[0]!;
    fixture.media.setEnabled(false);
    fixture.media.setEnabled(true);
    fixture.video.plays[1]!.resolve();
    fixture.video.dispatchEvent(new Event("playing"));
    oldBackground.reject(new Error("AbortError: source released"));
    await Promise.resolve();
    await Promise.resolve();
    assert(fixture.classes.has("video-playing"));
    assert.equal(fixture.video.dataset["state"], "environment");
    assert(fixture.video.src.endsWith("/market-landscape.mp4"));
  } finally {
    fixture.close();
  }
});
