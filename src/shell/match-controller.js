// One authority transition at a time. Keep the next quote private until the
// presentation finishes; presentation failures still commit accepted results.
export class MatchController {
  constructor({ provider, present, onChange = () => {}, onError = () => {} }) {
    this.provider = provider;
    this.present = present;
    this.onChange = onChange;
    this.onError = onError;
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
    };
  }
  emit() {
    this.onChange(this.state);
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
  setShot(shot) {
    if (this.state.busy || !["placed", "driven"].includes(shot)) return;
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
      const result = await this.provider.start({ stake: this.state.stake });
      Object.assign(this.state, {
        screen: "play",
        match: result.state,
        quote: result.quote,
        info: result.info,
        settlement: null,
        events: [],
        lastResolution: null,
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
    const quoteId = s.quote.quoteId;
    s.busy = true;
    this.emit();
    try {
      await this.present.preflight?.(option, s.quote.phase);
      const result = await this.provider.submit(option.id, quoteId);
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
      });
      s.events.push(result.resolution);
      s.screen = result.settlement ? "settled" : "play";
      this.refreshPlayableDirections();
      if (!result.settlement) {
        try {
          await this.present.prepare?.(result.state.phase);
        } catch (error) {
          this.onError(error);
        }
      }
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
    });
    this.emit();
    return true;
  }
}
