import test from "node:test";
import assert from "node:assert/strict";
import {
  choreography,
  ballPosition,
  TARGET_X,
  GOAL_Z,
} from "../src/presentation/choreography.js";
import { MatchController } from "../src/shell/match-controller.js";
import { LocalProvider } from "../src/providers/localProvider.js";
import { mediaVariant } from "../src/presentation/assets.js";
import { VideoBase } from "../src/presentation/video-base.js";
import {
  selectShotClip,
  VideoMatchScene,
} from "../src/presentation/video-match.js";
import { ShotMediaCache } from "../src/presentation/shot-media-cache.js";

for (const phase of ["attack", "defend"])
  for (const success of [true, false])
    for (const dir of ["L", "C", "R"]) {
      test(`visual direction and contact agree: ${phase} ${dir} ${success}`, () => {
        const plan = choreography({ phase, success, dir, shot: "placed" });
        assert.equal(plan.saved, phase === "attack" ? !success : success);
        if (phase === "attack") assert.equal(plan.ballDir, dir);
        else assert.equal(plan.diveDir, dir);
        assert.equal(plan.saved, plan.ballDir === plan.diveDir);
        const start = ballPosition(plan, 0);
        assert.ok(Math.abs(start.x) < 1e-9 && Math.abs(start.z) < 1e-9);
        assert.equal(start.y, 0.14);
        const end = ballPosition(plan, 1);
        assert.ok(Math.abs(end.x - TARGET_X[plan.ballDir]) < 1e-9);
        assert.equal(end.z, plan.saved ? GOAL_Z + 0.65 : GOAL_Z);
        for (let i = 0; i <= 20; i++)
          assert.ok(ballPosition(plan, i / 20).y >= 0.13);
      });
    }
test("portrait media selects a dedicated asset and falls back to landscape", () => {
  const entry = {
    portrait: { src: "port.mp4" },
    landscape: { src: "land.mp4" },
  };
  assert.equal(mediaVariant(entry, true).src, "port.mp4");
  assert.equal(mediaVariant(entry, false).src, "land.mp4");
  assert.equal(
    mediaVariant({ landscape: entry.landscape }, true).src,
    "land.mp4",
  );
});
const gate = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test("all shot outcomes require an approved clip with the exact ball and keeper directions", () => {
  const manifest = { gameplay: { shots: {} } };
  for (const phase of ["attack", "defend"])
    for (const dir of ["L", "C", "R"])
      for (const success of [true, false]) {
        const resolution = { phase, dir, success, shot: "placed" };
        assert.equal(selectShotClip(manifest, resolution), null);
        const plan = choreography(resolution);
        const key = `${plan.saved ? "save" : "goal"}-${plan.ballDir}-${plan.diveDir}`;
        const clip = {
          src: "reviewed.mp4",
          poster: "poster.webp",
          ballDir: plan.ballDir,
          diveDir: plan.diveDir,
          saved: plan.saved,
          kickAt: 1,
          impactAt: 2,
          duration: 5,
        };
        manifest.gameplay.shots[key] = { status: "pending", landscape: clip };
        assert.equal(selectShotClip(manifest, resolution), null);
        manifest.gameplay.shots[key].status = "approved";
        assert.equal(selectShotClip(manifest, resolution).key, key);
        // Incorrect footage must not become a substitute for the real outcome.
        const wrong = plan.ballDir === "L" ? "R" : "L";
        manifest.gameplay.shots[key].landscape = { ...clip, ballDir: wrong };
        assert.equal(selectShotClip(manifest, resolution), null);
        manifest.gameplay.shots[key].landscape = {
          ...clip,
          saved: !clip.saved,
        };
        assert.equal(selectShotClip(manifest, resolution), null);
        manifest.gameplay.shots[key].landscape = { ...clip, impactAt: 6 };
        assert.equal(selectShotClip(manifest, resolution), null);
        delete manifest.gameplay.shots[key];
      }
});

test("gameplay media marks kick and impact from video time, and cancellation releases playback", async () => {
  const { video, base } = videoSetup();
  const seen = [];
  const pending = base.playClip(
    { src: "shot.mp4", poster: "shot.webp", duration: 2 },
    { onTime: (t) => seen.push(t) },
  );
  video.currentTime = 0.75;
  video.dispatchEvent(new Event("timeupdate"));
  assert.deepEqual(seen, [0.75]);
  base.stop();
  assert.equal(await pending, false);
  video.currentTime = 1.5;
  video.dispatchEvent(new Event("timeupdate"));
  assert.deepEqual(seen, [0.75]);
});
test("double submissions, cash-outs and reset cannot race the active presentation", async () => {
  const animation = gate();
  let calls = 0;
  const provider = new LocalProvider({ seed: "busy-gate" });
  const original = provider.submit.bind(provider);
  provider.submit = async (...args) => {
    calls++;
    return original(...args);
  };
  const controller = new MatchController({
    provider,
    present: { play: () => animation.promise },
  });
  await controller.start();
  const quoteId = controller.state.quote.quoteId;
  const pending = controller.submit();
  await Promise.resolve();
  assert.equal(controller.state.busy, true);
  assert.equal(controller.state.quote.quoteId, quoteId);
  assert.equal(await controller.submit(), false);
  assert.equal(await controller.cashOut(), false);
  assert.equal(controller.reset(), false);
  animation.resolve();
  assert.equal(await pending, true);
  assert.equal(calls, 1);
  assert.equal(controller.state.busy, false);
  assert.notEqual(controller.state.quote.quoteId, quoteId);
  assert.equal(controller.state.events.length, 1);
});
test("an animation failure commits the accepted result and unlocks the next phase", async () => {
  const errors = [];
  const controller = new MatchController({
    provider: new LocalProvider({ seed: "recover-animation" }),
    present: {
      play: () => {
        throw new Error("context lost");
      },
    },
    onError: (e) => errors.push(e),
  });
  await controller.start();
  await controller.submit();
  assert.equal(controller.state.events.length, 1);
  assert.equal(controller.state.match.playerTaken, 1);
  assert.equal(controller.state.quote.phase, "defend");
  assert.equal(controller.state.busy, false);
  assert.equal(errors.length, 1);
});
test("presentation replay is isolated from the provider state", async () => {
  const provider = new LocalProvider({ seed: "replay-unchanged" });
  const controller = new MatchController({
    provider,
    present: { play: async () => {} },
  });
  await controller.start();
  await controller.submit();
  const before = JSON.stringify(provider.getState());
  const plan = choreography(controller.state.lastResolution);
  for (let i = 0; i < 100; i++) ballPosition(plan, i / 100);
  assert.equal(JSON.stringify(provider.getState()), before);
});
test("cash-out is available only after an attack/defense pair, and resolves once", async () => {
  const controller = new MatchController({
    provider: new LocalProvider({ seed: "cash-window" }),
    present: { play: async () => {} },
  });
  await controller.start();
  assert.equal(await controller.cashOut(), false);
  await controller.submit();
  assert.equal(await controller.cashOut(), false);
  await controller.submit();
  assert.equal(controller.state.quote.canCashOut, true);
  assert.equal(await controller.cashOut(), true);
  const settlement = controller.state.settlement;
  assert.equal(settlement.reason, "cashed");
  assert.equal(await controller.cashOut(), false);
  assert.strictEqual(controller.state.settlement, settlement);
  assert.equal(controller.reset(), true);
});

// Browser media policy errors must release the UI lock, even on silent devices.
class FakeVideo extends EventTarget {
  constructor() {
    super();
    this.classes = new Set();
    this.classList = {
      add: (x) => this.classes.add(x),
      remove: (x) => this.classes.delete(x),
    };
  }
  play() {
    return this.blocked
      ? Promise.reject(new Error("NotAllowedError"))
      : Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
const videoSetup = () => {
  globalThis.location = { search: "", hostname: "localhost" };
  globalThis.document = {
    baseURI: "http://localhost/",
    querySelector: () => null,
  };
  const video = new FakeVideo();
  return {
    video,
    base: new VideoBase(video, {
      cinematics: {
        intro: {
          landscape: { src: "intro.mp4", poster: "intro.webp", duration: 1 },
        },
      },
    }),
  };
};
test("autoplay rejection releases the cinematic to its photographic poster", async () => {
  const { video, base } = videoSetup();
  video.blocked = true;
  assert.equal(await base.play("intro"), false);
  assert.equal(video.classes.has("playing"), false);
  assert.equal(video.paused, true);
});
test("aborting or skipping a cinematic releases its pending promise", async () => {
  const { video, base } = videoSetup(),
    abort = new AbortController();
  const pending = base.play("intro", { signal: abort.signal });
  abort.abort();
  assert.equal(await pending, false);
  assert.equal(video.classes.has("playing"), false);
});
test("starting another clip cancels the old clip, and ended resolves the active one", async () => {
  const { video, base } = videoSetup(),
    first = base.play("intro"),
    second = base.play("intro");
  assert.equal(await first, false);
  video.dispatchEvent(new Event("ended"));
  assert.equal(await second, true);
  assert.equal(video.classes.has("playing"), false);
});

test("action footage can hold its final frame, and stop releases it", async () => {
  const { video, base } = videoSetup();
  const pending = base.play("intro", { holdLastFrame: true });
  video.dispatchEvent(new Event("ended"));
  assert.equal(await pending, true);
  assert.equal(video.classes.has("playing"), true);
  assert.equal(video.paused, true);
  base.stop();
  assert.equal(video.classes.has("playing"), false);
});

test("missing footage never fabricates kick or impact callbacks", async () => {
  let callbacks = 0;
  const scene = new VideoMatchScene({}, {});
  scene.manifest = { gameplay: { shots: {} } };
  await assert.rejects(
    scene.play(
      { phase: "attack", dir: "L", success: true },
      {
        onKick: () => callbacks++,
        onImpact: () => callbacks++,
      },
    ),
    /视频尚未就绪/,
  );
  assert.equal(callbacks, 0);
});

test("media preflight failure consumes no action and keeps the quote retryable", async () => {
  let submissions = 0;
  const provider = new LocalProvider({ seed: "no-text-substitute" });
  const original = provider.submit.bind(provider);
  provider.submit = (...args) => {
    submissions++;
    return original(...args);
  };
  const controller = new MatchController({
    provider,
    present: {
      preflight: async () => {
        throw new Error("video not ready");
      },
      play: async () => {
        throw new Error("must not present an absent clip");
      },
    },
  });
  await controller.start();
  const before = JSON.stringify(provider.getState());
  const quote = controller.state.quote.quoteId;
  assert.equal(await controller.submit(), false);
  assert.equal(submissions, 0);
  assert.equal(JSON.stringify(provider.getState()), before);
  assert.equal(controller.state.events.length, 0);
  assert.equal(controller.state.quote.quoteId, quote);
  assert.equal(controller.state.busy, false);
});

test("preflight requires both outcomes before loading either clip", async () => {
  let loaded = 0;
  const scene = new VideoMatchScene({}, {});
  scene.clips = { load: () => loaded++ };
  scene.manifest = { gameplay: { shots: {} } };
  await assert.rejects(scene.preflight({ dir: "L", shot: "placed" }, "attack"));
  assert.equal(loaded, 0);
});

test("shot cache releases failed requests so a failed download can be retried", async () => {
  videoSetup();
  let requests = 0;
  const cache = new ShotMediaCache({
    fetchMedia: async () => {
      requests++;
      return {
        ok: requests > 1,
        blob: async () => new Blob(["reviewed footage"]),
      };
    },
  });
  const clip = { src: "test.mp4", duration: 5 };
  await assert.rejects(cache.load(clip), /视频加载失败/);
  const loaded = await cache.load(clip);
  assert.ok(loaded.src.startsWith("blob:"));
  assert.equal(requests, 2);
  assert.equal((await cache.load(clip)).src, loaded.src);
  assert.equal(requests, 2);
  cache.destroy();
});

test("a held-frame opening still clears the video on failure or abort", async () => {
  for (const reason of ["blocked", "abort"]) {
    const { video, base } = videoSetup();
    const abort = new AbortController();
    video.blocked = reason === "blocked";
    const pending = base.play("intro", {
      signal: abort.signal,
      holdLastFrame: true,
    });
    if (reason === "abort") abort.abort();
    assert.equal(await pending, false);
    assert.equal(video.classes.has("playing"), false);
  }
});
