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
test("autoplay rejection returns to the live 3D scene", async () => {
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

test("opening can hold its final frame for the countdown, and stop releases it", async () => {
  const { video, base } = videoSetup();
  const pending = base.play("intro", { holdLastFrame: true });
  video.dispatchEvent(new Event("ended"));
  assert.equal(await pending, true);
  assert.equal(video.classes.has("playing"), true);
  assert.equal(video.paused, true);
  base.stop();
  assert.equal(video.classes.has("playing"), false);
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
