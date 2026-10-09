// LocalProvider —— 阶段一的本地模拟实现
//
// 它守住的是服务端契约，不是便利性：方法签名、返回结构、幂等与竞态语义
// 都与将来的 RemoteProvider 一致。所以接服务端时表现层零改动。
//
// 刻意保留的异步签名：即使本地是同步计算，也返回 Promise，
// 这样表现层从第一版起就按「等待权威结果」的方式写，不会隐含同步假设。

import { ShootoutEngine } from '../math/engine.js';
import { OutcomeProvider } from './outcomeProvider.js';

export class LocalProvider extends OutcomeProvider {
  constructor({ seed } = {}) {
    super();
    this.seedOverride = seed;
    this.engine = null;
  }

  async start({ stake }) {
    this.engine = new ShootoutEngine({ stake, seed: this.seedOverride });
    return {
      state: this.engine.getState(),
      quote: this.engine.getQuote(),
      info: this.engine.getPublicInfo(),
    };
  }

  async submit(actionId, quoteId) {
    const resolution = this.engine.submit(actionId, quoteId);
    return {
      resolution,
      state: this.engine.getState(),
      quote: this.engine.getQuote(),
      info: this.engine.getPublicInfo(),
      settlement: this.engine.getSettlement(),
    };
  }

  async cashOut(quoteId) {
    const settlement = this.engine.cashOut(quoteId);
    return { settlement, state: this.engine.getState() };
  }

  getState() {
    return this.engine ? this.engine.getState() : null;
  }
}
