// OutcomeProvider —— 服务端接入的唯一切换缝（SV-1）
//
// 表现层只通过这个接口拿数据，永远不直接碰 shootout-math。
// 阶段一用 LocalProvider（本地 seed + 本地 PRF）；
// 服务端阶段新增 RemoteProvider，沿用完全相同的方法签名与返回结构，
// 表现层与 shootout-math 都不需要改动。
//
// 接口约定：
//   start({ stake, lineup, mode, cupStage, enableChip }) -> { state, quote, info }
//   submit(actionId, quoteId) -> { resolution, state, quote, info, settlement? }
//   adjust(first, second, quoteId) -> { event, state, quote, info }
//   cashOut(quoteId)        -> { settlement, state }
//   getState()              -> MatchState 快照
//
// 所有方法都必须：
//   - 返回权威结果，客户端不自行计算
//   - 对相同 (actionId, quoteId) 幂等
//   - 收钱与继续竞争时只接受一个合法状态转换

/** @interface */
export class OutcomeProvider {
  async adjust() {
    throw new Error("OutcomeProvider.adjust not implemented");
  }
  async start(_opts) {
    throw new Error("未实现");
  }
  async submit(_actionId, _quoteId) {
    throw new Error("未实现");
  }
  async cashOut(_quoteId) {
    throw new Error("未实现");
  }
  getState() {
    throw new Error("未实现");
  }
}
