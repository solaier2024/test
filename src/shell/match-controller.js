import {
  DEFAULT_LINEUP,
  validateLineup,
  CUP_STAGES,
  autoDefense,
} from "../math/depth.js";
import { GameProgress } from "./progress.js";

// One authority transition at a time. Keep the next quote private until the
// presentation finishes; presentation failures still commit accepted results.
export class MatchController {
  constructor({
    provider,
    present,
    progress = new GameProgress(),
    onChange = () => {},
    onError = () => {},
  }) {
    this.provider = provider;
    this.present = present;
    this.onChange = onChange;
    this.onError = onError;
    this.progress = progress;
    this.preparedAt = Date.now();
    this.state = {
      screen: "bet",
      busy: false,
      stake: 10,
      shot: "placed",
      direction: "C",
      match: null,
      quote: null,
      info: null,
      settlement: null,
      events: [],
      lastResolution: null,
      playableDirections: ["L", "C", "R"],
      playableShots: ["placed", "driven"],
      lineup: [...progress.profile.lineup],
      mode: progress.profile.mode,
      competition: "single",
      profile: progress.profile,
      rewards: null,
      preparationMs: 0,
      activity: null,
    };
  }
  emit() {
    this.onChange(this.state);
  }
  async restore() {
    const result = this.provider.resume?.();
    if (!result) return false;
    const s = this.state;
    Object.assign(s, {
      match: result.state,
      quote: result.quote,
      info: result.info,
      settlement: result.settlement,
      screen: result.settlement ? "settled" : "play",
      mode: result.state.mode,
      lineup: [...result.state.lineup],
      competition: result.state.cupStage ? "cup" : "single",
      events: result.events,
      lastResolution: result.events.at(-1) ?? null,
      stake: result.state.stake,
      preparationMs: result.preparationMs ?? null,
      busy: true,
    });
    this.refreshPlayableDirections();
    this.finishProgress();
    this.emit();
    try {
      await this.present.prepare?.(result.state.phase);
    } finally {
      s.busy = false;
      this.emit();
    }
    return true;
  }
  setStake(stake) {
    if (
      this.state.screen !== "bet" ||
      this.state.busy ||
      ![5, 10, 20, 50].includes(stake)
    )
      return;
    this.state.stake = stake;
    this.emit();
  }
  setLineup(lineup) {
    if (this.state.busy || this.state.screen !== "bet") return false;
    this.state.lineup = validateLineup(lineup);
    this.emit();
    return true;
  }
  defaultLineup() {
    return this.setLineup(DEFAULT_LINEUP);
  }
  reuseLineup() {
    return this.setLineup(this.progress.profile.lineup);
  }
  setMode(mode) {
    if (
      this.state.busy ||
      this.state.screen !== "bet" ||
      !["full", "quick"].includes(mode)
    )
      return false;
    this.state.mode = mode;
    this.emit();
    return true;
  }
  setCompetition(competition) {
    if (
      this.state.busy ||
      this.state.screen !== "bet" ||
      !["single", "cup"].includes(competition)
    )
      return false;
    this.state.competition = competition;
    this.emit();
    return true;
  }
  setShot(shot) {
    if (this.state.busy || !["placed", "driven", "chip"].includes(shot)) return;
    if (
      shot === "chip" &&
      !this.state.quote?.options.some(
        (o) => o.shot === "chip" && this.present.supports?.(o, "attack"),
      )
    )
      return;
    this.state.shot = shot;
    this.refreshPlayableDirections();
    this.emit();
  }
  setDirection(dir) {
    if (this.state.busy || !["L", "C", "R"].includes(dir)) return;
    if (!this.state.playableDirections.includes(dir)) return;
    this.state.direction = dir;
    this.emit();
  }
  refreshPlayableDirections() {
    const s = this.state;
    if (!s.quote) return;
    s.playableShots = ["placed", "driven", "chip"].filter((shot) =>
      s.quote.options.some(
        (o) =>
          o.shot === shot && (this.present.supports?.(o, "attack") ?? true),
      ),
    );
    if (s.quote.phase === "attack" && !s.playableShots.includes(s.shot))
      s.shot = s.playableShots[0] ?? "placed";
    s.playableDirections = ["L", "C", "R"].filter((dir) => {
      const option = s.quote.options.find(
        (o) =>
          o.dir === dir && (s.quote.phase === "defend" || o.shot === s.shot),
      );
      return option && (this.present.supports?.(option, s.quote.phase) ?? true);
    });
    if (!s.playableDirections.includes(s.direction))
      s.direction = s.playableDirections[0] ?? "C";
  }
  async start() {
    if (this.state.busy || this.state.screen !== "bet") return false;
    this.state.busy = true;
    this.emit();
    try {
      let cupStage = null;
      if (this.state.competition === "cup") {
        this.progress.startCup();
        cupStage = CUP_STAGES[this.progress.profile.cup.stage].id;
      }
      this.state.preparationMs = Math.max(0, Date.now() - this.preparedAt);
      const result = await this.provider.start({
        stake: this.state.stake,
        lineup: this.state.lineup,
        mode: this.state.mode,
        cupStage,
        preparationMs: this.state.preparationMs,
        enableChip:
          this.present.supports?.({ dir: "C", shot: "chip" }, "attack") ??
          false,
      });
      this.progress.preferences({
        lineup: this.state.lineup,
        mode: this.state.mode,
      });
      Object.assign(this.state, {
        screen: "play",
        match: result.state,
        quote: result.quote,
        info: result.info,
        settlement: null,
        events: [],
        lastResolution: null,
        rewards: null,
      });
      this.refreshPlayableDirections();
      await this.present.prepare?.(result.state.phase);
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  currentOption() {
    const s = this.state;
    if (s.mode === "quick" && s.quote?.phase === "defend")
      return autoDefense(s.quote, s.playableDirections);
    return s.quote?.options.find(
      (o) =>
        o.dir === s.direction &&
        (s.quote.phase === "defend" || o.shot === s.shot),
    );
  }
  async submit() {
    const s = this.state;
    const option = this.currentOption();
    if (s.busy || s.screen !== "play" || !option || !s.quote) return false;
    s.busy = true;
    this.emit();
    try {
      let result;
      do {
        const selected = this.currentOption();
        if (!selected) throw new Error("缺少可播放的动作视频");
        if (s.mode === "quick" && s.quote.phase === "defend") {
          s.direction = selected.dir;
          this.emit();
        }
        s.activity = "loading";
        this.emit();
        await this.present.preflight?.(selected, s.quote.phase);
        s.activity = "playing";
        this.emit();
        result = await this.provider.submit(selected.id, s.quote.quoteId);
        try {
          await this.present.play(result.resolution);
        } catch (error) {
          this.onError(
            new Error("本球视频播放中断，可用回放重看；结果已保留", {
              cause: error,
            }),
          );
        }
        Object.assign(s, {
          match: result.state,
          quote: result.quote,
          info: result.info,
          settlement: result.settlement,
          lastResolution: result.resolution,
          lineup: [...result.state.lineup],
        });
        s.events.push(result.resolution);
        s.screen = result.settlement ? "settled" : "play";
        this.refreshPlayableDirections();
        this.finishProgress();
        if (!result.settlement) {
          try {
            await this.present.prepare?.(result.state.phase);
          } catch (error) {
            this.onError(error);
          }
        }
        this.emit();
      } while (
        !result.settlement &&
        s.mode === "quick" &&
        s.quote?.phase === "defend"
      );
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    } finally {
      s.busy = false;
      s.activity = null;
      this.emit();
    }
  }
  finishProgress() {
    const s = this.state;
    if (!s.settlement || s.rewards) return;
    this.progress.preferences({ lineup: s.lineup, mode: s.mode });
    s.rewards = this.progress.record(s.settlement, s.info.archetype);
    s.profile = this.progress.profile;
  }
  async adjust(first, second) {
    const s = this.state;
    if (s.busy || s.screen !== "play" || !s.quote?.canAdjust) return false;
    s.busy = true;
    this.emit();
    try {
      const result = await this.provider.adjust(first, second, s.quote.quoteId);
      Object.assign(s, {
        match: result.state,
        quote: result.quote,
        info: result.info,
        lineup: [...result.state.lineup],
      });
      this.refreshPlayableDirections();
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    } finally {
      s.busy = false;
      this.emit();
    }
  }
  async cashOut() {
    const s = this.state;
    if (s.busy || s.screen !== "play" || !s.quote?.canCashOut) return false;
    s.busy = true;
    this.emit();
    try {
      const result = await this.provider.cashOut(s.quote.quoteId);
      Object.assign(s, {
        match: result.state,
        settlement: result.settlement,
        quote: null,
        screen: "settled",
      });
      this.finishProgress();
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    } finally {
      s.busy = false;
      this.emit();
    }
  }
  reset() {
    if (this.state.busy || this.state.screen !== "settled") return false;
    Object.assign(this.state, {
      screen: "bet",
      match: null,
      quote: null,
      info: null,
      settlement: null,
      events: [],
      lastResolution: null,
      direction: "C",
      playableDirections: ["L", "C", "R"],
      rewards: null,
    });
    this.provider.release?.();
    this.preparedAt = Date.now();
    this.emit();
    return true;
  }
}
