import { StadiumAudio } from "./stadium-audio.js";

// Authoring only: render the same Web Audio graph used by the match, with no
// microphone, recording permissions or separate approximated audio engine.
export async function renderStadiumPreview(manifest) {
  const context = new OfflineAudioContext(2, 24000 * 24, 24000);
  const audio = new StadiumAudio({ enabled: true, context });
  await audio.load(manifest.audio);
  await audio.activate();
  audio.mode = "intro";
  audio.setMix(0);
  audio.scheduleTo(6);
  audio.mode = "match";
  audio.pressure = 0.3;
  audio.setMix(6);
  audio.whistle(6);
  audio.scheduleTo(10);
  audio.charging = true;
  audio.pressure = 1;
  audio.setMix(10);
  audio.scheduleTo(12.4);
  audio.kick(12.4);
  audio.scheduleTo(13.3);
  audio.result(true, 13.3);
  audio.scheduleTo(17);
  audio.inFlight = false;
  audio.charging = false;
  audio.setMix(17);
  audio.scheduleTo(21);
  audio.whistle(20.1);
  audio.kick(21);
  audio.result(false, 21.8);
  audio.scheduleTo(24);
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
