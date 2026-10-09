import { StadiumAudio } from "./stadium-audio.js";

// Authoring only: render the same Web Audio graph used by the match, with no
// microphone, recording permissions or separate approximated audio engine.
export async function renderStadiumPreview() {
  const context = new OfflineAudioContext(2, 24000 * 24, 24000);
  const audio = new StadiumAudio({ enabled: true, context });
  audio.activate();
  audio.ambience();
  audio.stopScheduler();
  let at = 0.15;
  for (let bar = 0; bar < 10; bar++)
    at += audio.scoreBar(at, bar, {
      pressure: bar < 6 ? 0.3 : 1,
      intro: bar < 2,
      charging: bar === 5,
    });
  audio.whistle();
  audio.tone(145, 0.18, 0.7, "sine", 12.0, 34);
  audio.burst(0.12, 0.45, 1400, 12.0);
  audio.stomp(16.8, 1.4);
  audio.clap(16.93, 1.25);
  audio.burst(2.4, 0.95, 950, 16.8);
  audio.hum(130.8, 0.9, 16.95, 1.3);
  const buffer = await context.startRendering();
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const wav = new ArrayBuffer(44 + buffer.length * 4);
  const view = new DataView(wav);
  const ascii = (offset, value) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, wav.byteLength - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, buffer.length * 4, true);
  for (let i = 0; i < buffer.length; i++)
    for (let c = 0; c < 2; c++)
      view.setInt16(
        44 + (i * 2 + c) * 2,
        Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767),
        true,
      );
  return new Blob([wav], { type: "audio/wav" });
}
