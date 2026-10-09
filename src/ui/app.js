import "./style.css";
import "./entrance.css";
import { LocalProvider } from "../providers/localProvider.js";
import { MatchController } from "../shell/match-controller.js";
import {
  loadManifest,
  loadFonts,
  assetUrl,
  mediaVariant,
} from "../presentation/assets.js";
import { VideoMatchScene } from "../presentation/video-match.js";
import { ShootoutHud } from "../presentation/hud.js";
import { VideoBase } from "../presentation/video-base.js";
import { commitment } from "../math/prf.js";
import { LoadingSequence, OpeningSequence } from "../presentation/entrance.js";
import { StadiumAudio } from "../presentation/stadium-audio.js";
import { renderStadiumPreview } from "../presentation/audio-preview.js";

const $ = (selector) => document.querySelector(selector);
const money = (n) => `$${Number(n).toFixed(2)}`;
const dirNames = { L: "左", C: "中", R: "右" };
const icon = (paths) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
$("#app").innerHTML = `
  <header class="topbar">
    <div class="brand"><svg viewBox="0 0 48 52" aria-hidden="true"><path d="M24 2 44 10v20L24 49 4 30V10z" fill="#1e222b" stroke="#856638"/><path d="M15 13h7v21h12v6H15z" fill="#ffc35a"/><path d="m28 13 11 7-11 7z" fill="#f28136"/></svg><div class="wordmark">LAST KICK<small>TANDA DE PENALES</small></div></div>
    <div class="top-tools"><span class="demo-badge">模拟币演示</span>
      <button id="sound" class="tool" aria-label="关闭声音" aria-pressed="true">${icon('<path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>')}</button>
      <button id="replay" class="tool" aria-label="回放上一球" disabled>${icon('<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/><path d="m11 8 6 4-6 4z"/>')}</button>
      <button id="help" class="tool" aria-label="玩法说明">${icon('<circle cx="12" cy="12" r="9"/><path d="M9.4 9a2.6 2.6 0 1 1 4.4 1.8c-1.2.6-1.8 1.3-1.8 2.7m0 2.7v.3"/>')}</button>
      <button id="fullscreen" class="tool" aria-label="全屏">${icon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>')}</button>
    </div>
  </header>
  <main class="game-shell"><section id="arena" aria-label="点球比赛">
    <div id="match-poster" aria-hidden="true"></div>
    <video id="match-video" muted playsinline aria-label="写实点球比赛画面"></video>
    <div class="lobby-backdrop" aria-hidden="true"></div>
    <div class="scene-vignette"></div><video id="cinematic" muted playsinline aria-label="球场短片"></video>
    <canvas id="hud" aria-hidden="true"></canvas><div id="a11y"></div><div id="live" role="status" aria-live="polite"></div>
    <div class="cinema-overlay" hidden>
      <div class="cinema-top"><span><i></i> MATCH NIGHT</span><span>LAST KICK</span></div>
      <button class="skip-video" type="button">跳过开场</button>
      <div class="cinema-letterbox top"></div><div class="cinema-letterbox bottom"></div>
      <div class="cinema-streak" aria-hidden="true"></div>
      <div class="cinema-title"></div><div class="cinema-count" hidden></div>
      <p class="cinema-subtitle"></p><div class="cinema-meter" aria-hidden="true"></div>
    </div>
    <div class="loading">
      <div class="loading-beam beam-left" aria-hidden="true"></div><div class="loading-beam beam-right" aria-hidden="true"></div>
      <span class="loading-eyebrow">THE STADIUM IS CALLING</span>
      <div class="loading-orbit" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><circle class="orbit-track" cx="50" cy="50" r="46"/><path d="m50 31 18 13-7 22H39l-7-22zM50 4v27M5 36l27 8M22 88l17-22m39 22L61 66m34-30-27 8"/></svg></div>
      <h1>LAST<span>KICK</span><b>.</b></h1>
      <p class="loading-tagline">全场屏息，等待你的关键一球。</p>
      <div class="loading-readout"><span class="loading-status" role="status">正在点亮球场…</span><span><b class="loading-percent">0</b>%</span></div>
      <progress max="1" value="0" aria-label="场景加载进度"></progress>
      <div class="loading-steps"><span>01 · 球场</span><span>02 · 视频</span><span>03 · 比赛</span></div>
    </div>
  </section><footer class="footer"><span><b>18+ · 模拟币演示</b>　所有返还均包含本金，比赛落败返还为 0。</span><span>5 ROUNDS · ONE LAST KICK</span></footer></main>
  <dialog id="dialog"><div class="dialog-head"><h2></h2><button class="tool" aria-label="关闭">×</button></div><div class="dialog-body"></div></dialog>`;

let scene,
  hud,
  media,
  controller,
  introPending = false,
  audioEnabled = true,
  replayBusy = false;
const audio = new StadiumAudio({ enabled: audioEnabled });
const opening = new OpeningSequence($("#arena"), $(".cinema-overlay"), audio);
const dialog = $("#dialog");
dialog.querySelector("button").onclick = () => dialog.close();
function openDialog(title, content) {
  dialog.querySelector("h2").textContent = title;
  dialog.querySelector(".dialog-body").replaceChildren();
  if (typeof content === "string")
    dialog.querySelector(".dialog-body").innerHTML = content;
  else dialog.querySelector(".dialog-body").append(content);
  dialog.showModal();
}
function toast(message) {
  $("#arena .toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.setAttribute("role", "alert");
  node.textContent = message;
  $("#arena").append(node);
  setTimeout(() => node.remove(), 4000);
}
function sound(success) {
  audio.result(success);
}
$("#sound").onclick = () => {
  audioEnabled = !audioEnabled;
  $("#sound").setAttribute("aria-pressed", String(audioEnabled));
  $("#sound").setAttribute(
    "aria-label",
    audioEnabled ? "关闭声音" : "开启声音",
  );
  $("#sound").innerHTML = icon(
    audioEnabled
      ? '<path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'
      : '<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6m0-6-5 6"/>',
  );
  audio.setEnabled(audioEnabled);
  if (audioEnabled && controller?.state.screen === "play") audio.ambience();
};
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("#app").requestFullscreen();
  } catch {
    toast("当前浏览器不支持全屏，可直接继续比赛");
  }
};
$("#help").onclick = () =>
  openDialog(
    "每一球，都有选择",
    `<p>你与对手交替罚球，共 5 轮；若比分已经无法追平，比赛提前结束。常规打平后最多进行 3 组骤死，仍打平则按当前现金价值返还。</p><h3>选择球路</h3><p>先选左、中、右，再选推射或抽射，最后确认。方向始终以射手视角为准，切换机位不会改变球路。推射更稳，抽射的返还波动更大。</p><h3>读懂对手</h3><p>门将具有预判型、反应型或固执型的习惯，每次射门都会留下方向记录。早期记忆会衰减，重复同一方向会影响门将倾向。防守时展示对手射手的赛前倾向。</p><h3>掌握比赛节奏</h3><p>每个动作显示成功率和两种结果下的返还。成功返还上升，失败返还下降；若比赛落败，返还为 0。完成一轮攻防后可以收取当前返还。</p><p>改变选择会改变成功率与波动，不会提高长期期望返还。初始现金价值是模拟投入的 96%，所有金额均已包含本金。本演示不涉及真实资金。</p><h3>操作</h3><p>点击球门目标或方向卡片选路。键盘 1 / 2 / 3 选方向，P / D 切换推射与抽射，Enter 确认。顶部回放按钮重演上一球，不改变比赛结果。</p>`,
  );
function showIntel() {
  const s = controller.state,
    defending = s.quote?.phase === "defend",
    prior = defending ? s.info.shooterTendency : s.info.preMatchTendency,
    dist = defending ? prior : (s.quote?.keeperDist ?? prior);
  const node = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = defending ? "对手射手" : s.info.archetypeName;
  node.append(heading);
  const desc = document.createElement("p");
  desc.textContent = defending
    ? "根据射手的赛前方向倾向选择扑救位置。射手倾向与门将的本场记忆分别记录。"
    : s.info.archetypeDesc;
  node.append(desc);
  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>方向</th><th>赛前倾向</th><th>当前倾向</th></tr></thead><tbody></tbody>";
  for (const dir of ["L", "C", "R"]) {
    const row = table.querySelector("tbody").insertRow();
    [
      dirNames[dir],
      `${Math.round(prior[dir] * 100)}%`,
      `${Math.round(dist[dir] * 100)}%`,
    ].forEach((v) => {
      row.insertCell().textContent = v;
    });
  }
  node.append(table);
  const history = document.createElement("p");
  history.textContent = `门将本场 ${s.info.memory.samples} 次记录：${s.info.memory.history.map((d) => dirNames[d]).join(" → ") || "暂无。首球使用赛前倾向。"}`;
  node.append(history);
  openDialog(s.quote?.phase === "defend" ? "对手射手情报" : "门将情报", node);
}
function showReport() {
  const s = controller.state,
    st = s.settlement,
    node = document.createElement("div");
  const summary = document.createElement("p");
  summary.textContent = `最终比分 ${s.match.playerGoals} : ${s.match.oppGoals} · 模拟投入 ${money(st.stake)} · 返还 ${money(st.payout)}`;
  node.append(summary);
  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>球次</th><th>选择</th><th>结果</th><th>返还</th></tr></thead><tbody></tbody>";
  st.events.forEach((e, i) => {
    const row = table.querySelector("tbody").insertRow();
    const success = e.kind === "attack" ? "进球" : "扑救";
    const failure = e.kind === "attack" ? "未进" : "失球";
    [
      String(i + 1),
      `${e.kind === "attack" ? "攻" : "守"} · ${dirNames[e.dir]}${e.shot ? (e.shot === "placed" ? " · 推射" : " · 抽射") : ""}`,
      e.success ? success : failure,
      money(e.cashAfter),
    ].forEach((v) => {
      row.insertCell().textContent = v;
    });
  });
  node.append(table);
  const title = document.createElement("h3");
  title.textContent = "本地演示结果校验";
  node.append(title);
  const note = document.createElement("p");
  note.textContent =
    commitment(st.seedRevealed) === st.commitment
      ? "Seed 与开局承诺一致。此处为本地演示校验。"
      : "校验失败";
  node.append(note);
  for (const [label, value] of [
    ["Seed", st.seedRevealed],
    ["Commitment", st.commitment],
    ["配置版本", st.configVersion],
    ["结算编号", st.settlementId],
  ]) {
    const p = document.createElement("p");
    p.textContent = label;
    const code = document.createElement("code");
    code.textContent = value;
    node.append(p, code);
  }
  openDialog("比赛战报", node);
}
function announce(s) {
  const stage =
    s.screen === "bet"
      ? "选择模拟投入并进入球场"
      : s.screen === "settled"
        ? `比赛已结算，返还 ${money(s.settlement.payout)}`
        : `第 ${s.match.round} 轮，${s.quote?.phase === "attack" ? "射门" : "扑救"}阶段。比分 ${s.match.playerGoals} 比 ${s.match.oppGoals}。当前返还 ${money(s.match.cashValue)}`;
  $("#live").textContent = stage;
  $("#arena").dataset.screen = s.screen;
  $("#arena").dataset.busy = String(s.busy);
  $("#arena").dataset.phase = s.quote?.phase ?? s.screen;
  $("#replay").disabled = s.busy || replayBusy || !s.lastResolution;
}
async function replay() {
  const s = controller.state;
  if (s.busy || replayBusy || !s.lastResolution) return;
  replayBusy = true;
  s.busy = true;
  controller.emit();
  try {
    await scene.prepare(s.lastResolution.phase);
    await scene.setCamera("broadcast");
    let resultAnimation;
    await scene.play(s.lastResolution, {
      onKick: () => audio.kick(),
      onImpact: () => {
        resultAnimation = hud.showResult(s.lastResolution);
        sound(s.lastResolution.success);
      },
    });
    await resultAnimation;
    await scene.setCamera(hud.mode);
    await scene.prepare(s.quote?.phase ?? "attack");
  } catch (error) {
    toast("回放暂时不可用，比赛可继续");
  } finally {
    replayBusy = false;
    s.busy = false;
    controller.emit();
  }
}
$("#replay").onclick = replay;

async function boot() {
  const loading = $(".loading");
  const loader = new LoadingSequence(loading);
  try {
    loader.progress(0.06, "正在点亮球场…");
    const manifest = await loadManifest();
    loader.progress(0.12, "聚光灯已开启");
    const lobby = $(".lobby-backdrop");
    const setLobbyPoster = () => {
      const clip = mediaVariant(
        manifest.cinematics?.intro,
        $("#arena").clientWidth < 850,
      );
      if (clip?.source === "OpenArt / Seedance 2.0")
        lobby.style.backgroundImage = `url("${assetUrl(clip.poster)}")`;
    };
    setLobbyPoster();
    scene = new VideoMatchScene($("#match-video"), $("#match-poster"), {
      onProgress: (v, text) => {
        loader.progress(0.12 + v * 0.65, text);
      },
      onMissing: toast,
    });
    await Promise.all([scene.init(manifest), loadFonts()]);
    // Wait briefly for display fonts; default local fonts work offline as well.
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    loader.progress(0.85, "写实画面就绪 · 比赛即将开始");
    const present = {
      prepare: async (phase) => {
        await scene.prepare(phase);
        if (introPending) {
          introPending = false;
          await opening.play(media, scene);
        }
      },
      play: async (resolution) => {
        let resultAnimation;
        await scene.play(resolution, {
          fast: matchMedia("(prefers-reduced-motion: reduce)").matches,
          onKick: () => audio.kick(),
          onImpact: () => {
            resultAnimation = hud.showResult(resolution);
            sound(resolution.success);
          },
        });
        await resultAnimation;
      },
    };
    const provider = new LocalProvider({
      seed: import.meta.env.DEV
        ? (new URLSearchParams(location.search).get("seed") ?? undefined)
        : undefined,
    });
    controller = new MatchController({
      provider,
      present,
      onChange: (s) => {
        scene.showcase = s.screen === "bet";
        audio.match(s);
        hud.update(s);
        announce(s);
      },
      onError: (error) => toast(error.message),
    });
    hud = new ShootoutHud($("#hud"), $("#a11y"), scene, {
      stake: (n) => controller.setStake(n),
      shot: (id) => controller.setShot(id),
      direction: (dir) => controller.setDirection(dir),
      option: () => controller.currentOption(),
      start: async () => {
        audio.activate();
        introPending = !matchMedia("(prefers-reduced-motion: reduce)").matches;
        scene.showcase = false;
        if (await controller.start()) {
          audio.ambience();
          $("#control-submit")?.focus({ preventScroll: true });
        }
      },
      submit: () => controller.submit(),
      cash: () => controller.cashOut(),
      reset: () => {
        if (controller.reset()) {
          audio.stopAmbience();
          scene.prepare("attack");
          media.warm("intro");
        }
      },
      intel: showIntel,
      report: showReport,
      camera: (id) => {
        if (controller.state.busy) return;
        hud.mode = id;
        hud.render();
        scene.setCamera(id);
      },
    });
    await hud.init();
    loader.progress(0.95, "全场就绪");
    media = new VideoBase($("#cinematic"), manifest, {
      portrait: () => hud.mobile,
    });
    const resize = () => {
      setLobbyPoster();
      const arena = $("#arena"),
        size = hud.resize(arena.clientWidth, arena.clientHeight);
      for (const node of [
        $("#cinematic"),
        $(".scene-vignette"),
        $(".lobby-backdrop"),
      ])
        Object.assign(node.style, {
          width: `${size.width}px`,
          height: `${size.height}px`,
        });
      if ($("#cinematic").classList.contains("playing")) {
        opening.stop();
        media.stop();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe($("#arena"));
    resize();
    controller.emit();
    media.warm("intro");
    await loader.finish();
    for (const canvas of [$("#hud")]) {
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        opening.stop();
        media.stop();
        scene.suspend();
        toast("图形设备正在恢复，比赛结果会保留");
      });
      canvas.addEventListener("webglcontextrestored", () => {
        resize();
        controller.emit();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (
        dialog.open ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        $(".capture") ||
        controller.state.screen !== "play" ||
        controller.state.busy
      )
        return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
        return;
      const dir = { 1: "L", 2: "C", 3: "R" }[event.key];
      if (dir) {
        event.preventDefault();
        controller.setDirection(dir);
      }
      if (event.key.toLowerCase() === "p") controller.setShot("placed");
      if (event.key.toLowerCase() === "d") controller.setShot("driven");
      if (event.key === "Enter" && event.target.tagName !== "BUTTON") {
        event.preventDefault();
        controller.submit();
      }
    });
    document.addEventListener("visibilitychange", () =>
      audio.setHidden(document.hidden),
    );
    window.addEventListener(
      "pagehide",
      () => {
        opening.stop();
        audio.destroy();
        media.destroy();
        scene.destroy();
        hud.destroy();
        observer.disconnect();
      },
      { once: true },
    );
    if (
      import.meta.env.DEV &&
      new URLSearchParams(location.search).has("audio-preview")
    )
      createAudioPreview();
  } catch (error) {
    scene?.destroy();
    hud?.destroy();
    loader.fail(`球场加载失败：${error.message}`);
    const retry = document.createElement("button");
    retry.textContent = "重新加载球场";
    retry.onclick = () => location.reload();
    loading.append(retry);
    console.error(error);
  }
}
// Development-only audio authoring export, isolated from match/provider state.
function createAudioPreview() {
  const box = document.createElement("div");
  box.className = "capture";
  const button = document.createElement("button");
  button.textContent = "导出24秒鼓点试听";
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = "正在合成球场声场…";
    try {
      const blob = await renderStadiumPreview();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "last-kick-stadium-preview.wav";
      a.textContent = "下载鼓点与低吟试听";
      box.append(a);
      box.dataset.audio = "rendered";
    } catch (error) {
      toast(error.message);
    }
    button.textContent = "导出24秒鼓点试听";
    button.disabled = false;
  };
  box.append(button);
  $("#arena").append(box);
}

boot();
