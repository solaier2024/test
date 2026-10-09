// 带种子的伪随机函数：PRF(seed, 路径) -> [0,1)
//
// 玩家的选择决定读取随机性的哪一条分支，但无法影响任何分支里的数值。
// 同一个 seed + 同一条决策路径必须永远产出同一场比赛。
//
// 服务端接入后，seed 由服务端生成并先下发 hash(seed) 作为承诺；
// 本模块的实现保持不变，以保证客户端可以重放并校验。

/** 把字符串混成一个 32 位整数（xmur3） */
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** 对 32 位整数再做一轮扩散，避免相邻 key 产生相关序列 */
function scramble(x) {
  x = (x + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * 从 seed 与决策路径导出一个 [0,1) 的值。
 * @param {string} seed
 * @param {string} path 形如 "r1:atk:L-placed" 的路径标识，须包含到当前为止的完整决策链
 * @returns {number}
 */
export function prf(seed, path) {
  const a = hashString(`${seed}|${path}`);
  const b = scramble(a);
  // 用 53 位有效精度，避免只取 32 位导致的粒度问题
  const hi = b >>> 5; // 27 bits
  const lo = scramble(b) >>> 6; // 26 bits
  return (hi * 67108864 + lo) / 9007199254740992;
}

/** 生成一个本地 seed（阶段一用；服务端接入后由服务端生成） */
export function makeLocalSeed() {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 承诺值。真正的可证明公平需要绑定会话、规则与配置版本以及完整动作日志；
 * 单独的 seed 哈希不证明 seed 生成过程无偏 —— 这里只是阶段一的占位实现。
 */
export function commitment(seed) {
  return hashString(`commit|${seed}`).toString(16).padStart(8, '0');
}
