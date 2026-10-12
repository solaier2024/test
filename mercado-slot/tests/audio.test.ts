import assert from "node:assert/strict";
import { test } from "node:test";
import { MarketAudio } from "../src/presentation/audio.ts";

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Recording {
  paused = true;
  crossOrigin = "";
  loop = false;
  preload = "none";
  src = "";
  currentTime = 12.5;
  plays: ReturnType<typeof deferred>[] = [];
  loads = 0;
  play() {
    this.paused = false;
    const attempt = deferred();
    this.plays.push(attempt);
    return attempt.promise;
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads++;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}
class Node {
  targets: number[] = [];
  gain = {
    value: 1,
    setTargetAtTime: (value: number) => this.targets.push(value),
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
  frequency = { value: 0 };
  Q = { value: 0 };
  buffer: unknown;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  disconnected = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}
class Context {
  static instances: Context[] = [];
  state = "suspended";
  sampleRate = 100;
  currentTime = 5;
  destination = new Node();
  gains: Node[] = [];
  buffers: Node[] = [];
  mediaNodes: Node[] = [];
  constructor() {
    Context.instances.push(this);
  }
  createGain() {
    const node = new Node();
    this.gains.push(node);
    return node;
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(100) };
  }
  createBufferSource() {
    const node = new Node();
    this.buffers.push(node);
    return node;
  }
  createBiquadFilter() {
    return new Node();
  }
  createMediaElementSource() {
    const node = new Node();
    this.mediaNodes.push(node);
    return node;
  }
  async decodeAudioData() {
    return {};
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.state = "closed";
  }
}
async function setup() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["AudioContext", "document", "location", "fetch"];
  const originals = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Context.instances = [];
  globals["AudioContext"] = Context;
  globals["document"] = {
    baseURI: "https://audio.test/",
    querySelector: () => null,
  };
  globals["location"] = { hostname: "audio.test" };
  globals["fetch"] = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  const recording = new Recording();
  const audio = new MarketAudio(recording as unknown as HTMLAudioElement);
  const restore = () => {
    audio.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    }
  };
  return { audio, recording, restore };
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("entrance unlock starts one streamed score; repeated spin unlocks never stack decoders", async () => {
  const { audio, recording, restore } = await setup();
  try {
    assert(audio.enabled && audio.music);
    await audio.unlock();
    await audio.unlock();
    assert.equal(recording.src, "https://audio.test/media/street-fiesta.m4a");
    assert.equal(recording.crossOrigin, "anonymous");
    assert.equal(recording.loop, true);
    assert.equal(recording.plays.length, 1);
    assert.equal(Context.instances.length, 1);
    assert.equal(Context.instances[0]!.mediaNodes.length, 1);
    recording.plays[0]!.resolve();
    await settle();
    await audio.unlock();
    assert.equal(recording.plays.length, 1);
  } finally {
    restore();
  }
});

test("music toggle stops the score without muting cooking ambience or result cues", async () => {
  const { audio, recording, restore } = await setup();
  try {
    await audio.unlock();
    await settle();
    const context = Context.instances[0]!;
    const grill = context.buffers[0]!;
    audio.setMusic(false);
    assert(recording.paused);
    assert.equal(context.state, "running");
    assert.equal(context.gains[1]!.targets.at(-1), 0);
    assert.equal(context.gains[2]!.targets.at(-1), 0.22);
    assert(grill.started && !grill.stopped);
    audio.cue("return");
    assert(context.buffers.at(-1)!.started);
    assert.equal(recording.plays.length, 1);
    audio.setMusic(true);
    assert.equal(recording.plays.length, 2);
    assert.equal(recording.currentTime, 12.5);
  } finally {
    restore();
  }
});

test("opening pauses the score and mutes its ambience; stale play rejection cannot affect the resume", async () => {
  const { audio, recording, restore } = await setup();
  try {
    await audio.unlock();
    audio.setCinematic(true);
    assert(recording.paused);
    const context = Context.instances[0]!;
    assert.equal(context.gains[1]!.targets.at(-1), 0);
    assert.equal(context.gains[2]!.targets.at(-1), 0);
    await audio.unlock();
    assert.equal(recording.plays.length, 1);
    audio.setCinematic(false);
    assert.equal(recording.plays.length, 2);
    recording.plays[0]!.reject(new Error("AbortError: interrupted by CG"));
    await settle();
    await audio.unlock();
    assert.equal(recording.plays.length, 2);
    assert.equal(recording.paused, false);
    assert.equal(recording.currentTime, 12.5);
  } finally {
    restore();
  }
});

test("hidden tabs and master mute suspend audio; only an eligible visible page resumes", async () => {
  const { audio, recording, restore } = await setup();
  try {
    await audio.unlock();
    audio.setHidden(true);
    assert(recording.paused);
    assert.equal(Context.instances[0]!.state, "suspended");
    audio.setEnabled(false);
    audio.setHidden(false);
    await settle();
    assert.equal(Context.instances[0]!.state, "suspended");
    assert.equal(recording.plays.length, 1);
    audio.setEnabled(true);
    await settle();
    assert.equal(Context.instances[0]!.state, "running");
    assert.equal(recording.plays.length, 2);
    assert.equal(recording.currentTime, 12.5);
  } finally {
    restore();
  }
});

test("a blocked music request is recoverable and disposal releases the decoder", async () => {
  const { audio, recording, restore } = await setup();
  try {
    await audio.unlock();
    recording.paused = true;
    recording.plays[0]!.reject(new Error("NotAllowedError"));
    await settle();
    await audio.unlock();
    assert.equal(recording.plays.length, 2);
    audio.dispose();
    recording.plays[1]!.reject(new Error("AbortError"));
    await settle();
    await audio.unlock();
    assert(recording.paused);
    assert.equal(recording.src, "");
    assert.equal(Context.instances.length, 1);
    assert.equal(Context.instances[0]!.state, "closed");
    assert(Context.instances[0]!.mediaNodes[0]!.disconnected);
  } finally {
    restore();
  }
});
