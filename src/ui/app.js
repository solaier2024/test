import "./style.css";
import "./entrance.css";
import "./depth.css";
import { LocalProvider } from "../providers/localProvider.js";
import { MatchController } from "../shell/match-controller.js";
import {
  loadManifest,
  loadFonts,
  assetUrl,
  mediaVariant,
} from "../presentation/assets.js";
import { VideoMatchScene } from "../presentation/video-match.js";
import { choreography } from "../presentation/choreography.js";
import { ShootoutHud } from "../presentation/hud.js";
import { VideoBase } from "../presentation/video-base.js";
import { commitment } from "../math/prf.js";
import { LoadingSequence, OpeningSequence } from "../presentation/entrance.js";
import { StadiumAudio } from "../presentation/stadium-audio.js";
import { renderStadiumPreview } from "../presentation/audio-preview.js";
import { GameProgress, matchHighlights } from "../shell/progress.js";
import { DepthPanels } from "./depth-panels.js";
import { CUP_STAGES, QUICK_POLICY } from "../math/depth.js";
import { verifySettlement } from "../math/replay.js";

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
      <button id="career" class="tool" aria-label="生涯成绩与杯赛">${icon('<path d="M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 15v5m-5 1h10"/>')}</button>
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
      <button class="skip-video" type="button" aria-label="跳过开场">${icon('<path d="m6 5 9 7-9 7zM18 5v14"/>')}</button>
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
  replayBusy = false,
  audioEntries = null;
const audio = new StadiumAudio({ enabled: audioEnabled });
const opening = new OpeningSequence($("#arena"), $(".cinema-overlay"), audio);
const dialog = $("#dialog");
const panels = new DepthPanels({
  controller: () => controller,
  open: openDialog,
  close: () => dialog.close(),
  toast,
});
$("#career").onclick = () => controller && panels.career();
dialog.querySelector("button").onclick = () => dialog.close();
function openDialog(title, content) {
  dialog.querySelector("h2").textContent = title;
  dialog.querySelector(".dialog-body").replaceChildren();
  if (typeof content === "string")
    dialog.querySelector(".dialog-body").innerHTML = content;
  else dialog.querySelector(".dialog-body").append(content);
  if (!dialog.open) dialog.showModal();
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
  if (audioEnabled && audioEntries) audio.load(audioEntries);
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
    `<p>你与对手交替罚球，共 5 轮；若比分已经无法追平，比赛提前结束。常规打平后最多 3 组骤死，仍打平则按当前现金价值返还。</p><h3>阵容与射法</h3><p>赛前安排五名不同球员的顺序。神射手特化推射，重炮特化抽射，冰血只屏蔽本人射门的规定压力扣减；门将记忆仍然生效。常规每人一球，骤死从阵容首位重新轮转。中路进攻和艺术家独立吊射的视频待补齐，目前无法提交。</p><h3>观察与压力</h3><p>主操作区持续显示门将押向或射手威胁。低、中、高三级压力受近期结果、比分落后、常规末轮与骤死影响；进球或扑救可以降低近期压力。当前成功率和成功／失败返还已经包括特质与压力，详情可在“阵容·压力”查看。</p><h3>教练与收取</h3><p>完成攻防一轮后可收取当前返还。每场一次教练调整，只能在轮末交换两名未出场球员，不重置比分、压力和门将记忆。交换后会发布新报价。</p><h3>快速模式</h3><p>${QUICK_POLICY.desc} 快速模式减少操作次数；视频仍逐球播放，整局时长取决于球数和决策时间。</p><h3>杯赛与成长</h3><p>三场杯赛分别面对边路先锋、反应猎手和预判大师。每场独立投入、开局与结算，胜利才晋级；平局、落败或主动收取结束本届。成绩、称号和球衣徽章保存在当前浏览器，不改变概率或返还。</p><h3>返还与操作</h3><p>成功返还上升，失败返还下降；比赛落败返还为 0。初始现金价值为模拟投入的 96%，所有金额包含本金，改变选择不提高长期期望返还。键盘 1 / 2 / 3 选方向，P / D 切换射法，Enter 确认。顶部回放只重演已接受的结果。本演示不涉及真实资金。</p>`,
  );
function showIntel() {
  const s = controller.state;
  if (s.screen === "bet") {
    const stage =
      s.competition === "cup"
        ? CUP_STAGES[
            s.profile.cup?.status === "active" ? s.profile.cup.stage : 0
          ]
        : null;
    const preview = controller.provider.preview?.({
      cupStage: stage?.id ?? null,
    });
    if (!preview) return;
    const node = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = stage
      ? `${stage.name} · ${stage.rival}`
      : preview.archetypeName;
    const desc = document.createElement("p");
    desc.textContent = stage?.desc ?? preview.archetypeDesc;
    node.append(title, desc);
    for (const [label, dist] of [
      ["门将赛前押向", preview.preMatchTendency],
      ["射手威胁", preview.shooterTendency],
    ]) {
      const line = document.createElement("p");
      line.textContent = `${label}：左 ${Math.round(dist.L * 100)}% · 中 ${Math.round(dist.C * 100)}% · 右 ${Math.round(dist.R * 100)}%`;
      node.append(line);
    }
    const note = document.createElement("p");
    note.textContent =
      "这是本次开局的公开简报。进入比赛后，球员特质、压力与门将记忆共同形成当前动作报价。";
    node.append(note);
    openDialog("赛前对手简报", node);
    return;
  }
  const defending = s.quote?.phase === "defend",
    prior = defending ? s.info.shooterTendency : s.info.preMatchTendency,
    dist = defending ? prior : (s.quote?.keeperDist ?? prior);
  const node = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = defending ? "对手射手" : s.info.archetypeName;
  node.append(heading);
  const desc = document.createElement("p");
  desc.textContent = defending
    ? "射手威胁权重影响各方向的公开扑救概率。本场实际球路与玩家扑救方向分开记录；当前视频矩阵中的动作方向依结果匹配，不把少量视频样本当成威胁权重的频率估计。"
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
  history.textContent = defending
    ? `对手实际球路：${s.info.opponentHistory.map((e) => `${dirNames[e.ballDir]}${e.saved ? "（扑出）" : "（进球）"}`).join(" → ") || "尚未罚球"}`
    : `门将本场 ${s.info.memory.samples} 次记录：${s.info.memory.history.map((d) => dirNames[d]).join(" → ") || "暂无。首球使用赛前倾向。"}`;
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
  const highlights = document.createElement("div");
  highlights.className = "report-highlights";
  matchHighlights(st).forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    highlights.append(p);
  });
  node.append(highlights);
  const timing = document.createElement("p");
  const preparation =
    s.preparationMs == null
      ? "准备计时未保存"
      : `准备 ${(s.preparationMs / 1000).toFixed(1)} 秒`;
  timing.textContent = `${st.config.mode === "quick" ? "快速模式 · 自动防守" : "完整模式"} · ${preparation} · 开局至结算 ${(st.elapsedMs / 1000).toFixed(1)} 秒（含等待和离开）${st.config.cupStage ? ` · ${CUP_STAGES.find((stage) => stage.id === st.config.cupStage).name}` : ""}`;
  node.append(timing);
  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>事件</th><th>球员／动作</th><th>真实球路／扑向</th><th>概率／压力</th><th>结果</th><th>返还</th></tr></thead><tbody></tbody>";
  st.events.forEach((e, i) => {
    const row = table.querySelector("tbody").insertRow();
    const success = e.kind === "attack" ? "进球" : "扑出";
    const failure = e.kind === "attack" ? "未进" : "失球";
    [
      String(i + 1),
      e.kind === "coach"
        ? `交换第 ${e.slots[0] + 1} 与 ${e.slots[1] + 1} 名`
        : `${e.player?.name ?? "守门员"} · ${dirNames[e.dir]}${e.shot ? ` · ${{ placed: "推射", driven: "抽射", chip: "吊射" }[e.shot]}` : ""}`,
      e.kind === "coach"
        ? "保留原记忆"
        : `球 ${dirNames[e.ballDir]}／扑 ${dirNames[e.diveDir]}`,
      e.kind === "coach"
        ? "发布新报价"
        : `${Math.round(e.probability * 100)}%／${e.pressureBefore.name}`,
      e.kind === "coach" ? "调整" : e.success ? success : failure,
      money(e.cashAfter),
    ].forEach((v) => {
      row.insertCell().textContent = v;
    });
  });
  const scroll = document.createElement("div");
  scroll.className = "report-scroll";
  scroll.append(table);
  node.append(scroll);
  const title = document.createElement("h3");
  title.textContent = "本地演示结果校验";
  node.append(title);
  const note = document.createElement("p");
  note.textContent = verifySettlement(st)
    ? "Seed 与开局承诺一致；已按初始阵容、配置、教练事件与全部动作重演，概率、方向、比分和返还一致。此处为本地演示校验。"
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
        : `${s.match.suddenDeath ? "骤死第" : "第"} ${s.match.suddenDeath ? s.match.sdSet : s.match.round} ${s.match.suddenDeath ? "组" : "轮"}，${s.quote?.phase === "attack" ? `${s.quote.player.name}射门` : "扑救"}阶段。压力${s.quote?.pressure.name}。比分 ${s.match.playerGoals} 比 ${s.match.oppGoals}。当前返还 ${money(s.match.cashValue)}`;
  if ($("#live").textContent !== stage) $("#live").textContent = stage;
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
    $("#arena").dataset.cinematic = "replay";
    scene.resize($("#arena").clientWidth, $("#arena").clientHeight);
    await scene.prepare(s.lastResolution.phase);
    await scene.setCamera("broadcast");
    await scene.play(s.lastResolution, {
      onKick: () => audio.kick(),
      onImpact: () => {
        sound(s.lastResolution.success);
      },
    });
  } catch (error) {
    toast("回放暂时不可用，比赛可继续");
  } finally {
    delete $("#arena").dataset.cinematic;
    try {
      hud.resize($("#arena").clientWidth, $("#arena").clientHeight);
      await scene.setCamera(hud.mode);
      await scene.prepare(s.quote?.phase ?? "attack");
    } catch {
      toast("球场视频暂时不可用，可重试回放");
    }
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
    audioEntries = manifest.audio;
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
    });
    const fontReady = loadFonts(),
      audioReady = audio.load(manifest.audio);
    audioReady.then((failed) => {
      if (failed) toast("部分现场声音加载失败，比赛可继续；重新开启声音可重试");
    });
    await scene.init(manifest);
    // Font/audio requests continue in the background after this bounded wait.
    await Promise.race([
      Promise.all([fontReady, audioReady]),
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
        await scene.play(resolution, {
          onKick: () => audio.kick(),
          onImpact: () => {
            sound(resolution.success);
          },
        });
      },
      preflight: (option, phase) => scene.preflight(option, phase),
      supports: (option, phase) => scene.supports(option, phase),
    };
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      /* In-memory progression remains available. */
    }
    const provider = new LocalProvider({
      storage,
      seed: import.meta.env.DEV
        ? (new URLSearchParams(location.search).get("seed") ?? undefined)
        : undefined,
    });
    controller = new MatchController({
      provider,
      present,
      progress: new GameProgress(storage),
      onChange: (s) => {
        scene.showcase = s.screen === "bet";
        audio.match(s);
        hud.update(s);
        announce(s);
        if (!s.busy && s.screen === "play")
          scene.warm(s.quote, controller.currentOption());
      },
      onError: (error) => toast(error.message),
    });
    hud = new ShootoutHud($("#hud"), $("#a11y"), scene, {
      stake: (n) => controller.setStake(n),
      mode: (mode) => controller.setMode(mode),
      competition: (competition) => controller.setCompetition(competition),
      lineup: () => panels.lineup(),
      career: () => panels.career(),
      shot: (id) => controller.setShot(id),
      direction: (dir) => controller.setDirection(dir),
      option: () => controller.currentOption(),
      start: async () => {
        await audio.activate();
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
    fontReady.then(() => !hud.destroyed && hud.state && hud.render());
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
    if (!(await controller.restore())) controller.emit();
    if (provider.restoreError) toast(provider.restoreError);
    document.addEventListener(
      "pointerdown",
      () => audio.activate().catch(() => {}),
      { once: true },
    );
    document.addEventListener(
      "keydown",
      () => audio.activate().catch(() => {}),
      { once: true },
    );
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
    document.addEventListener("visibilitychange", () => {
      audio.setHidden(document.hidden);
      scene.setHidden(document.hidden);
      if (!document.hidden) hud.invalidate();
    });
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) {
        audio.setHidden(true);
        scene.setHidden(true);
        return;
      }
      opening.stop();
      audio.destroy();
      media.destroy();
      scene.destroy();
      hud.destroy();
      observer.disconnect();
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        audio.setHidden(document.hidden);
        scene.setHidden(document.hidden);
        hud.invalidate();
      }
    });
    if (
      import.meta.env.DEV &&
      new URLSearchParams(location.search).has("audio-preview")
    )
      createAudioPreview(manifest);
    if (
      import.meta.env.DEV &&
      new URLSearchParams(location.search).has("clip-preview")
    )
      createClipPreview(manifest);
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
function createAudioPreview(manifest) {
  const box = document.createElement("div");
  box.className = "capture";
  const button = document.createElement("button");
  button.textContent = "导出24秒现场声音";
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = "正在合成球场声场…";
    try {
      const blob = await renderStadiumPreview(manifest);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "last-kick-stadium-live.wav";
      a.textContent = "下载心跳、呼吸与观众试听";
      box.append(a);
      box.dataset.audio = "rendered";
    } catch (error) {
      toast(error.message);
    }
    button.textContent = "导出24秒现场声音";
    button.disabled = false;
  };
  box.append(button);
  $("#arena").append(box);
}

// Authoring preview: exercise the real video scene without a provider submit.
// Keep the final frame until the reviewer leaves, and keep these controls off
// the picture. This utility is removed from the production bundle.
function createClipPreview(manifest) {
  const select = document.createElement("select");
  select.className = "tool clip-preview-control";
  select.setAttribute("aria-label", "选择预览视频");
  const resolutions = ["attack", "defend"].flatMap((phase) =>
    ["L", "C", "R"].flatMap((dir) =>
      [true, false].flatMap((success) =>
        ["placed", "driven"].map((shot) => ({ phase, dir, success, shot })),
      ),
    ),
  );
  resolutions.push(
    ...[true, false].map((success) => ({
      phase: "attack",
      dir: "C",
      success,
      shot: "chip",
    })),
  );
  const choices = new Map();
  for (const [key, entry] of Object.entries(manifest.gameplay.shots)) {
    const clip = entry.landscape;
    const resolution = resolutions.find((r) => {
      const plan = choreography(r);
      return (
        (r.shot === "chip") === (clip.shotType === "chip") &&
        plan.ballDir === clip.ballDir &&
        plan.diveDir === clip.diveDir &&
        plan.saved === clip.saved
      );
    });
    if (!resolution || entry.status !== "approved") continue;
    choices.set(key, resolution);
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${clip.shotType === "chip" ? "吊射 · " : ""}${clip.saved ? "扑出" : "进球"} · 球${dirNames[clip.ballDir]} / 门将${dirNames[clip.diveDir]}`;
    select.append(option);
  }
  const button = document.createElement("button");
  button.className = "tool clip-preview-control";
  button.textContent = "预览射门视频";
  const arena = $("#arena");
  let active = false;
  button.onclick = async () => {
    if (active) {
      active = false;
      select.disabled = false;
      delete arena.dataset.cinematic;
      hud.resize(arena.clientWidth, arena.clientHeight);
      await scene.prepare(controller.state.quote?.phase ?? "attack");
      controller.state.busy = false;
      controller.emit();
      if (controller.state.screen !== "play") audio.stopAmbience();
      button.textContent = "预览射门视频";
      return;
    }
    if (controller.state.busy) return;
    active = true;
    select.disabled = true;
    button.disabled = true;
    controller.state.busy = true;
    controller.emit();
    await audio.activate();
    audio.ambience();
    arena.dataset.cinematic = "preview";
    scene.resize(arena.clientWidth, arena.clientHeight);
    try {
      await scene.play(choices.get(select.value), {
        onKick: () => audio.kick(),
        onImpact: () => sound(choices.get(select.value).success),
      });
    } catch (error) {
      toast(error.message);
    } finally {
      button.textContent = "返回比赛";
      button.disabled = false;
    }
  };
  const controls = document.createElement("div");
  controls.className = "clip-preview-tools";
  controls.append(select, button);
  $(".topbar").classList.add("clip-preview-header");
  $(".topbar").insertBefore(controls, $(".top-tools"));
}

boot();
