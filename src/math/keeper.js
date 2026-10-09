// 门将原型、赛前倾向与有限记忆（S1-1 ~ S1-4）
//
// 设计约束：
// - 赛前倾向在第一轮即可展示，解决「首轮无数据」的问题
// - 本场记录与赛前倾向分开显示，并显示样本数量
// - 记忆有衰减且偏移有上限，重复不会让某个方向永久不可用
// - 不同原型的学习与衰减速度不同

export const DIRS = ['L', 'C', 'R'];
export const DIR_LABEL = { L: '左', C: '中', R: '右' };

/**
 * 三种门将原型。
 * learn  —— 记忆更新速度
 * decay  —— 早期记录的衰减速度（越小衰减越快）
 * memW   —— 扑救方向里「本场记忆」相对「赛前倾向」的权重
 * cap    —— 单个方向的猜中概率上限，防止某方向被永久封死
 */
export const ARCHETYPES = {
  anticipator: {
    id: 'anticipator',
    name: '预判型',
    desc: '关注最近射门方向，容易提前移动',
    learn: 1.0,
    decay: 0.55,
    memW: 0.72,
    cap: 0.62,
  },
  reactor: {
    id: 'reactor',
    name: '反应型',
    desc: '较少提前移动，不同射法有不同应对表现',
    learn: 0.45,
    decay: 0.75,
    memW: 0.38,
    cap: 0.50,
  },
  stubborn: {
    id: 'stubborn',
    name: '固执型',
    desc: '初始方向偏好明显，调整较慢',
    learn: 0.3,
    decay: 0.9,
    memW: 0.25,
    cap: 0.58,
  },
};

/** 归一化一个三方向分布 */
function normalize(w) {
  const s = w.L + w.C + w.R;
  return { L: w.L / s, C: w.C / s, R: w.R / s };
}

/** 从 PRF 导出一个确定性的赛前倾向（不同 seed 得到不同对手） */
export function makePreMatchTendency(rand) {
  const raw = { L: 0.6 + rand() * 1.4, C: 0.5 + rand() * 1.0, R: 0.6 + rand() * 1.4 };
  return normalize(raw);
}

/** 初始的空记忆 */
export function initialMemory() {
  return { L: 0, C: 0, R: 0, samples: 0, history: [] };
}

/**
 * 记录玩家一次射门方向。进球、被扑、打偏均留下记录。
 * 先对已有记录做衰减，再加入新记录 —— 所以最近的权重更高。
 */
export function rememberShot(memory, archetype, dir) {
  const a = ARCHETYPES[archetype];
  const next = {
    L: memory.L * a.decay,
    C: memory.C * a.decay,
    R: memory.R * a.decay,
    samples: memory.samples + 1,
    history: [...memory.history, dir],
  };
  next[dir] += a.learn;
  return next;
}

/**
 * 门将的扑救方向分布 = 赛前倾向 与 本场记忆 的加权混合。
 * 每个方向的概率设上限 cap，保证重复不会让该方向永久不可用。
 */
export function keeperDiveDistribution(preMatch, memory, archetype) {
  const a = ARCHETYPES[archetype];
  const memTotal = memory.L + memory.C + memory.R;
  let blended;
  if (memTotal <= 0) {
    blended = { ...preMatch };
  } else {
    const mem = normalize({ L: memory.L, C: memory.C, R: memory.R });
    // 记忆权重随样本量上升，但不超过 memW
    const w = a.memW * Math.min(1, memory.samples / 3);
    blended = {
      L: preMatch.L * (1 - w) + mem.L * w,
      C: preMatch.C * (1 - w) + mem.C * w,
      R: preMatch.R * (1 - w) + mem.R * w,
    };
  }
  // 施加上限并把溢出量按比例分给其他方向
  const capped = { ...blended };
  let overflow = 0;
  for (const d of DIRS) {
    if (capped[d] > a.cap) {
      overflow += capped[d] - a.cap;
      capped[d] = a.cap;
    }
  }
  if (overflow > 0) {
    const room = DIRS.filter((d) => capped[d] < a.cap);
    const roomTotal = room.reduce((s, d) => s + (a.cap - capped[d]), 0);
    if (roomTotal > 0) {
      for (const d of room) capped[d] += overflow * ((a.cap - capped[d]) / roomTotal);
    }
  }
  return normalize(capped);
}

/**
 * 可见线索：把门将当前倾向转成一句玩家能读的话。
 * 线索的生成过程与实际概率一致 —— 不是装饰。
 */
export function keeperHint(dist, memory) {
  const top = DIRS.reduce((best, d) => (dist[d] > dist[best] ? d : best), 'L');
  const spread = Math.max(dist.L, dist.C, dist.R) - Math.min(dist.L, dist.C, dist.R);
  if (memory.samples === 0) {
    return `赛前情报：门将偏向${DIR_LABEL[top]}侧（本场尚无记录）`;
  }
  if (spread < 0.08) return `门将站位居中，暂无明显偏向（本场 ${memory.samples} 次记录）`;
  const strength = spread > 0.25 ? '明显' : '略微';
  return `门将${strength}偏向${DIR_LABEL[top]}侧（本场 ${memory.samples} 次记录）`;
}

/** 对手射手的方向倾向（玩家防守时可读，D1 的防守侧信息） */
export function makeShooterTendency(rand) {
  const raw = { L: 0.6 + rand() * 1.5, C: 0.4 + rand() * 0.9, R: 0.6 + rand() * 1.5 };
  return normalize(raw);
}
