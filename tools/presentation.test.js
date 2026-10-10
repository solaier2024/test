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
import { StadiumAudio } from "../src/presentation/stadium-audio.js";
import { readFile } from "node:fs/promises";

test("reviewed production pack unlocks both outcomes on each available direction", async () => {
  const scene = new VideoMatchScene({}, {});
  scene.manifest = JSON.parse(
    await readFile(
      new URL("../public/assets/media-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const loaded = [];
  scene.clips = { load: async (clip) => loaded.push(clip.key) };
  for (const phase of ["attack", "defend"])
    for (const dir of ["L", "C", "R"]) {
      for (const shot of ["placed", "driven"]) {
        assert.equal(scene.supports({ dir, shot }, phase), true);
        await scene.preflight({ dir, shot }, phase);
      }
    }
  assert.equal(new Set(loaded).size, 8);
  for (const success of [true, false]) {
    const clip = selectShotClip(scene.manifest, {
      phase: "attack",
      dir: "C",
      shot: "chip",
      success,
    });
    assert.equal(clip.key, success ? "chip-goal-C-R" : "chip-save-C-C");
    assert.equal(clip.shotType, "chip");
  }
  assert.equal(scene.supports({ dir: "C", shot: "chip" }, "attack"), true);
  await scene.preflight({ dir: "C", shot: "chip" }, "attack");
  assert.equal(new Set(loaded).size, 10);
  assert.equal(scene.manifest.gameplay.shotPackStatus, "complete");
  assert.equal(scene.manifest.gameplay.chipPackStatus, "complete");
  const trimmed = scene.manifest.gameplay.shots["save-L-L"].landscape;
  assert.ok(trimmed.duration > trimmed.impactAt && trimmed.duration < 3.58);
});

test("right driven goal reuses footage with its actual right ball and right dive", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../public/assets/media-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const resolution = {
    phase: "attack",
    dir: "R",
    shot: "driven",
    success: true,
  };
  const plan = choreography(resolution);
  assert.equal(plan.ballDir, "R");
  assert.equal(plan.diveDir, "R");
  assert.equal(plan.saved, false);
  assert.equal(selectShotClip(manifest, resolution).key, "goal-R-R");
  assert.equal(
    selectShotClip(manifest, { ...resolution, success: false }).key,
    "save-R-R",
  );
  assert.equal(
    selectShotClip(manifest, { ...resolution, dir: "C" }).key,
    "goal-C-R",
  );
});

test("missing direction is visibly unavailable without changing the authoritative quote", async () => {
  const scene = new VideoMatchScene({}, {});
  scene.manifest = JSON.parse(
    await readFile(
      new URL("../public/assets/media-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const provider = new LocalProvider({ seed: "partial-video-pack" });
  delete scene.manifest.gameplay.shots["goal-C-R"];
  delete scene.manifest.gameplay.shots["chip-save-C-C"];
  const controller = new MatchController({
    provider,
    present: {
      supports: (...args) => scene.supports(...args),
      play: async () => {},
    },
  });
  await controller.start();
  assert.deepEqual(controller.state.playableDirections, ["L", "R"]);
  assert.equal(controller.state.direction, "L");
  assert.equal(controller.state.quote.options.length, 6);
  const quoteId = controller.state.quote.quoteId;
  controller.setDirection("C");
  assert.equal(controller.state.direction, "L");
  assert.equal(controller.state.quote.quoteId, quoteId);
  await controller.submit();
  assert.deepEqual(controller.state.playableDirections, ["L", "C", "R"]);
  controller.setDirection("C");
  assert.equal(controller.state.direction, "C");
});

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

test("penalty whistle waits for preparation and plays once per quote including the opponent turn", () => {
  const audio = new StadiumAudio();
  let whistles = 0;
  audio.whistle = () => whistles++;
  const state = {
    screen: "play",
    busy: true,
    quote: { quoteId: "attack-1" },
    match: { round: 1 },
  };
  audio.match(state);
  assert.equal(whistles, 0);
  state.busy = false;
  audio.match(state);
  assert.equal(whistles, 1);
  audio.match({ ...state, direction: "L" });
  audio.match({ ...state, busy: true });
  audio.match(state); // Failed submission or replay restores the same quote.
  assert.equal(whistles, 1);
  audio.match({ ...state, quote: { quoteId: "defend-1" } });
  assert.equal(whistles, 2);
  audio.match({ screen: "bet" });
  audio.match(state); // A new match may reuse the same authoring quote ID.
  assert.equal(whistles, 3);
});

test("a muted or hidden penalty whistle schedules no source and is not replayed on unmute", () => {
  const audio = new StadiumAudio({ enabled: false });
  audio.samples.whistle = { duration: 0.6 };
  audio.context = {
    currentTime: 0,
    createBufferSource: () => assert.fail("must not schedule"),
  };
  audio.penaltyReady("muted-quote");
  audio.enabled = true;
  audio.penaltyReady("muted-quote");
  audio.hidden = true;
  audio.penaltyReady("hidden-quote");
  audio.hidden = false;
  audio.penaltyReady("hidden-quote");
  assert.equal(audio.sources.size, 0);
});

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

test("a cancelled idle play promise cannot pause a new action or replay", async () => {
  const { video, base } = videoSetup();
  let rejectIdle;
  const idlePlay = new Promise((_resolve, reject) => (rejectIdle = reject));
  let plays = 0;
  video.play = () => {
    video.paused = false;
    return ++plays === 1 ? idlePlay : Promise.resolve();
  };
  base.idle({ src: "idle.mp4", poster: "idle.webp" });
  const pending = base.play("intro", { holdLastFrame: true });
  rejectIdle(new Error("The source was replaced"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(video.paused, false);
  assert.equal(video.classes.has("playing"), true);
  video.dispatchEvent(new Event("ended"));
  assert.equal(await pending, true);
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
    /Kick video is not ready/,
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

test("an unreviewed stadium crowd prevents provider submission and consumes no ball", async () => {
  const scene = new VideoMatchScene({}, {});
  scene.manifest = {
    gameplay: {
      crowdMotionRequired: true,
      idle: { crowdMotion: "pending" },
      shots: {},
    },
  };
  let loads = 0;
  scene.clips = { load: async () => loads++ };
  const provider = new LocalProvider({ seed: "crowd-not-ready" });
  const controller = new MatchController({
    provider,
    present: {
      preflight: (...args) => scene.preflight(...args),
      play: async () => assert.fail("must not play"),
    },
  });
  await controller.start();
  const before = JSON.stringify(provider.getState());
  const quote = controller.state.quote.quoteId;
  assert.equal(await controller.submit(), false);
  assert.equal(JSON.stringify(provider.getState()), before);
  assert.equal(controller.state.quote.quoteId, quote);
  assert.equal(controller.state.events.length, 0);
  assert.equal(controller.state.busy, false);
  assert.equal(loads, 0);
});

test("both result clips require reviewed spectator reactions before either is downloaded", async () => {
  const scene = new VideoMatchScene({}, {});
  scene.manifest = {
    gameplay: {
      crowdMotionRequired: true,
      idle: { crowdMotion: "approved" },
      shots: {},
    },
  };
  for (const success of [true, false]) {
    const plan = choreography({ phase: "attack", dir: "L", success });
    const key = `${plan.saved ? "save" : "goal"}-${plan.ballDir}-${plan.diveDir}`;
    scene.manifest.gameplay.shots[key] = {
      status: "approved",
      crowdMotion: success ? "approved" : "pending",
      landscape: {
        src: `${key}.mp4`,
        poster: `${key}.webp`,
        ballDir: plan.ballDir,
        diveDir: plan.diveDir,
        saved: plan.saved,
        kickAt: 1,
        impactAt: 2,
        duration: 5,
      },
    };
  }
  const loaded = [];
  scene.clips = { load: async (clip) => loaded.push(clip.key) };
  await assert.rejects(
    scene.preflight({ dir: "L" }, "attack"),
    /Crowd reactions are not ready/,
  );
  assert.deepEqual(loaded, []);
  scene.manifest.gameplay.shots["save-L-L"].crowdMotion = "approved";
  await scene.preflight({ dir: "L" }, "attack");
  assert.deepEqual(loaded, ["goal-L-R", "save-L-L"]);
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
