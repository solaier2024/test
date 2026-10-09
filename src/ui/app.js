// 表现层 —— 首版程序化占位美术
//
// 边界：本文件不含任何游戏逻辑与权威计算。
// 它只做三件事：把 provider 返回的报价画出来、收集玩家选择、呈现 RoundResolution。
// 按架构约定，整层可在 S3 替换为 Pixi + 视频基座而不影响 shootout-math。

import { LocalProvider } from '../providers/localProvider.js';
import { DIRS, DIR_LABEL } from '../math/keeper.js';
import { SHOT_TYPES } from '../math/actions.js';

const STAKES = [5, 10, 20, 50];
const MONEY = (v) => v.toFixed(2);

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 动画播放期间禁用所有动作按钮，避免重复提交 */
function disableOptions() {
  for (const b of document.querySelectorAll('.opt, .btn.cash')) b.disabled = true;
}

const state = {
  provider: null,
  stake: 10,
  shotType: 'placed',
  quote: null,
  match: null,
  info: null,
  settlement: null,
  busy: false,
  screen: 'bet',
  lastResolution: null,
  history: [],
  prevKeeperDist: null, // 上一次进攻时的门将倾向，用于显示记忆带来的变化
};

const root = document.getElementById('app');

// ---------------------------------------------------------------- 渲染

function render() {
  root.innerHTML = '';
  const head = el('div', 'full');
  head.appendChild(el('h1', null, '点球大赛 <span style="color:var(--dim);font-weight:400;font-size:13px">Tanda de Penales</span>'));
  head.appendChild(
    el('div', 'sub', '首版灰盒 · S0+S1 · 程序化占位美术 · 本地模拟（服务端后期接入）')
  );
  root.appendChild(head);

  if (state.screen === 'bet') return renderBet();
  if (state.screen === 'settled') return renderSettled();
  renderPlay();
}

function renderBet() {
  const c = el('div', 'card');
  c.appendChild(el('h2', null, '选择下注额（MXN）'));
  const row = el('div', 'stakes');
  for (const s of STAKES) {
    const b = el('button', state.stake === s ? 'on' : null, String(s));
    b.onclick = () => {
      state.stake = s;
      render();
    };
    row.appendChild(b);
  }
  c.appendChild(row);
  c.appendChild(
    el(
      'div',
      'note',
      `目标 RTP 96%。开局可兑现金额为 <b style="color:var(--accent)">${MONEY(
        state.stake * 0.96
      )}</b>，之后随每次结果上下浮动 —— 任何打法的期望返还都等于这个数，你选择的是波动形态而不是期望值。`
    )
  );
  const go = el('button', 'btn primary', '开始点球大战');
  go.onclick = startMatch;
  c.appendChild(go);
  root.appendChild(c);

  const rules = el('div', 'card');
  rules.appendChild(el('h2', null, '规则'));
  rules.appendChild(
    el(
      'div',
      'gate',
      `常规赛最多 <b>5 轮</b>，每轮你先罚球再扑救。<br>
       提前锁定胜负即终局。平局进入 <b>限定骤死赛（最多 3 组）</b>，仍平则按当前可兑现金额全额返还。<br>
       收钱窗口在每个完整攻防轮结束后。<br>
       <b>常规落败返还为零</b> —— 此前每次报价都已把该风险计入。<br>
       首版不含压力、阵容、教练调整、快速模式与双倍罚球。`
    )
  );
  root.appendChild(rules);

  const gates = el('div', 'card');
  gates.appendChild(el('h2', null, '本版已通过的数学门禁'));
  gates.appendChild(
    el(
      'div',
      'gate',
      `<b>S0-7</b> 完整状态求解：穷举 1,850,400 个状态，Vmax = Vmin = W×r（偏差 1.2e-14）<br>
       <b>S0-8</b> 无损继续区间：97,020 个收钱窗口、2,141,208 个动作，0 处「继续严格优于收钱」<br>
       <b>S0-9</b> 蒙特卡洛回归：14 组策略 × 6 万局，RTP 全部落在目标置信区间内<br>
       <b>单元测试</b> 28 项全通过（PRF 决定性、幂等、竞态、终局表、记忆上限）`
    )
  );
  root.appendChild(gates);
}

function pips(taken, goals, total) {
  const wrap = el('span', 'pips');
  for (let i = 0; i < total; i++) {
    const p = el('span', 'pip');
    if (i < taken) p.classList.add(i < goals ? 'goal' : 'miss');
    wrap.appendChild(p);
  }
  return wrap;
}

function renderPlay() {
  const m = state.match;
  const q = state.quote;
  const info = state.info;

  // ---- HUD
  const hud = el('div', 'card');
  const grid = el('div', 'hud');
  const mk = (lbl, val, cls) => {
    const b = el('div', 'box');
    b.appendChild(el('div', 'lbl', lbl));
    b.appendChild(el('div', `val ${cls ?? ''}`, val));
    return b;
  };
  grid.appendChild(mk('比分', `${m.playerGoals} <small>:</small> ${m.oppGoals}`));
  grid.appendChild(
    mk('可兑现', `${MONEY(m.cashValue)}`, 'cash')
  );
  grid.appendChild(
    mk('轮次', m.suddenDeath ? `骤死 ${m.sdSet}/3` : `${m.round}<small>/5</small>`)
  );
  hud.appendChild(grid);

  const shots = el('div', 'shots');
  const me = el('span', null, '你 ');
  me.appendChild(pips(m.playerTaken, m.playerGoals, m.suddenDeath ? m.playerTaken : 5));
  const opp = el('span', null, '对手 ');
  opp.appendChild(pips(m.oppTaken, m.oppGoals, m.suddenDeath ? m.oppTaken : 5));
  shots.appendChild(me);
  shots.appendChild(opp);
  hud.appendChild(shots);
  root.appendChild(hud);

  // ---- 球门
  const pitchCard = el('div', 'card');
  pitchCard.appendChild(buildPitch());
  // 关键球
  if (q?.keyBall) pitchCard.appendChild(el('div', 'keyball', `⚡ ${q.keyBall.text}`));
  // 线索
  if (q?.phase === 'attack') {
    pitchCard.appendChild(el('div', 'hint', `👁 ${q.keeperHint}`));
  } else if (q) {
    pitchCard.appendChild(
      el('div', 'hint', `👁 对手射手倾向如下（赛前情报 · 本场已罚 ${m.oppTaken} 次）`)
    );
  }
  root.appendChild(pitchCard);

  // ---- 动作
  if (q) root.appendChild(buildActions(q, info));

  // ---- 倾向图
  root.appendChild(buildTendency(q, info));

  // ---- 日志
  if (state.history.length) {
    const lg = el('div', 'card');
    lg.appendChild(el('h2', null, '本场记录'));
    const box = el('div', 'log');
    for (const h of [...state.history].reverse()) box.appendChild(el('div', null, h));
    lg.appendChild(box);
    root.appendChild(lg);
  }
}

function buildPitch() {
  const p = el('div', 'pitch');
  const frame = el('div', 'goalframe');
  const zones = el('div', 'zones');
  const q = state.quote;
  const dist = q?.keeperDist;
  for (const d of DIRS) {
    const z = el('div', 'zone');
    const heat = el('div', 'heat');
    if (dist) heat.style.opacity = String(Math.min(0.55, Math.max(0, (dist[d] - 0.2) * 1.5)));
    z.appendChild(heat);
    if (dist) z.appendChild(el('div', 'pct', `${Math.round(dist[d] * 100)}%`));
    zones.appendChild(z);
  }
  frame.appendChild(zones);
  p.appendChild(frame);

  const keeper = el('div', 'keeper');
  keeper.id = 'keeper';
  frame.appendChild(keeper);

  const ball = el('div', 'ball');
  ball.id = 'ball';
  p.appendChild(ball);
  p.appendChild(el('div', 'spot'));

  const banner = el('div', 'banner');
  banner.id = 'banner';
  p.appendChild(banner);
  return p;
}

function buildActions(q, info) {
  const c = el('div', 'card');
  if (q.phase === 'attack') {
    c.appendChild(el('h2', null, '进攻 · 选择方向与射法'));
    const tr = el('div', 'typeRow');
    for (const t of Object.values(SHOT_TYPES)) {
      const b = el(
        'button',
        state.shotType === t.id ? 'on' : null,
        `${t.name}<span style="font-size:11px;color:var(--dim)"> · 风险 ${Math.round(t.risk * 100)}%</span>`
      );
      b.onclick = () => {
        state.shotType = t.id;
        render();
      };
      tr.appendChild(b);
    }
    c.appendChild(tr);

    const opts = el('div', 'opts cols3');
    for (const d of DIRS) {
      const o = q.options.find((x) => x.dir === d && x.shot === state.shotType);
      opts.appendChild(optButton(o, DIR_LABEL[d], q));
    }
    c.appendChild(opts);
    c.appendChild(
      el(
        'div',
        'note',
        '门将会记住你罚过的方向。重复同一侧会被盯上 —— 命中率下降，但赔付同步上升，期望值不变。'
      )
    );
  } else {
    c.appendChild(el('h2', null, '防守 · 选择扑救方向'));
    const opts = el('div', 'opts cols3');
    for (const d of DIRS) {
      const o = q.options.find((x) => x.dir === d);
      opts.appendChild(
        optButton(o, DIR_LABEL[d], q, `对手 ${Math.round((o?.shooterProb ?? 0) * 100)}%`)
      );
    }
    c.appendChild(opts);
    c.appendChild(
      el('div', 'note', '扑对方向概率高但赔付低；扑冷门概率低但赔付高。两者期望值相同。')
    );
  }

  if (q.canCashOut) {
    const row = el('div', 'btnRow');
    const cash = el('button', 'btn cash', `收钱 ${MONEY(q.cashValue)}`);
    cash.onclick = doCashOut;
    const cont = el('button', 'btn ghost', '继续比赛');
    cont.onclick = () => {
      /* 继续就是直接选动作，这里只作说明 */
    };
    cont.disabled = true;
    cont.style.opacity = '.6';
    cont.textContent = '↑ 选择一个动作即继续';
    row.appendChild(cash);
    row.appendChild(cont);
    c.appendChild(row);
  }
  return c;
}

function optButton(o, label, q, extra) {
  const b = el('button', 'opt' + (o?.failureIsLoss ? ' allin' : ''));
  b.appendChild(el('div', 'dir', label));
  b.appendChild(el('div', 'p', `${(o.p * 100).toFixed(0)}%`));
  const br = el('div', 'br');
  br.innerHTML =
    `<b>成 ${MONEY(o.onSuccess)}</b><br><i>败 ${MONEY(o.onFailure)}${
      o.failureIsLoss ? ' 全失' : ''
    }</i>` + (extra ? `<br><span style="color:#7e8fa6">${extra}</span>` : '');
  b.appendChild(br);
  b.disabled = state.busy;
  b.onclick = () => doSubmit(o.id, q.quoteId);
  return b;
}

function buildTendency(q, info) {
  const c = el('div', 'card');
  const isAttack = q?.phase === 'attack';
  c.appendChild(
    el('h2', null, isAttack ? '门将倾向（赛前情报 + 本场记录）' : '对手射手倾向（赛前情报）')
  );
  const dist = isAttack ? q.keeperDist : info.shooterTendency;
  const prev = isAttack ? state.prevKeeperDist : null;
  const top = DIRS.reduce((a, d) => (dist[d] > dist[a] ? d : a), 'L');
  const row = el('div', 'tend');
  for (const d of DIRS) {
    const t = el('div', 't' + (d === top ? ' hot' : ''));
    t.appendChild(el('div', 'd', DIR_LABEL[d]));
    const bar = el('div', 'bar');
    const span = el('span');
    span.style.width = `${Math.round(dist[d] * 100)}%`;
    bar.appendChild(span);
    t.appendChild(bar);
    const pct = Math.round(dist[d] * 100);
    let deltaHtml = '';
    if (prev) {
      const dp = pct - Math.round(prev[d] * 100);
      if (dp !== 0) {
        const up = dp > 0;
        deltaHtml = `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'}${Math.abs(dp)}</span>`;
      }
    }
    t.appendChild(el('div', 'v', `${pct}%${deltaHtml}`));
    row.appendChild(t);
  }
  c.appendChild(row);
  if (isAttack && prev) {
    c.appendChild(
      el('div', 'note', '▲▼ 表示相对你上一次罚球时的变化 —— 门将记忆正在生效。')
    );
  }

  const a = info;
  c.appendChild(
    el(
      'div',
      'note',
      isAttack
        ? `对手门将：<b style="color:var(--ink)">${a.archetypeName}</b> —— ${a.archetypeDesc}。` +
            `<br>你的射门记录：${
              a.memory.history.length
                ? a.memory.history.map((h) => DIR_LABEL[h]).join(' → ')
                : '尚无'
            }（${a.memory.samples} 次样本，小样本不代表确定预测）`
        : '赛前情报来自对手配置，第一轮即可使用。本场记录样本较少时不代表确定预测。'
    )
  );
  return c;
}

function renderSettled() {
  const s = state.settlement;
  const won = s.payout > 0;
  const reasonText = {
    win: '赢下点球大战',
    loss: '点球大战落败 · 返还为零',
    draw: '骤死赛三组仍平 · 按可兑现金额返还',
    cashed: '主动收钱',
  }[s.reason];

  const c = el('div', 'card');
  const r = el('div', 'result');
  r.appendChild(
    el('div', `big ${won ? 'win' : 'lose'}`, `${won ? '+' : ''}${MONEY(s.payout)} MXN`)
  );
  r.appendChild(el('div', 'why', `${reasonText} · 下注 ${MONEY(s.stake)}`));
  c.appendChild(r);
  root.appendChild(c);

  // 战报（D6）—— 来自真实事件日志
  const rep = el('div', 'card');
  rep.appendChild(el('h2', null, '战报'));
  const ul = el('ul', 'report');
  for (const line of buildReport(s)) ul.appendChild(el('li', null, line));
  rep.appendChild(ul);
  rep.appendChild(
    el(
      'div',
      'note',
      '战报只陈述发生过的事件与状态变化，不把单次随机结果说成技术正确或失误。'
    )
  );
  root.appendChild(rep);

  const pf = el('div', 'card');
  pf.appendChild(el('h2', null, '可验证性'));
  pf.appendChild(
    el(
      'div',
      'proof',
      `承诺值 commitment：${s.commitment}<br>揭示的 seed：${s.seedRevealed}<br>` +
        `配置版本：${s.configVersion}<br>结算标识：${s.settlementId}<br>` +
        `动作日志：${s.actionLog.join(' → ')}`
    )
  );
  pf.appendChild(
    el(
      'div',
      'note',
      '同一个 seed 与同一条决策路径必定重放出同一场比赛。注意：阶段一的承诺只是占位实现 —— 单独的 seed 哈希不证明 seed 生成过程无偏，正式随机流程需单独定义与验证。'
    )
  );
  root.appendChild(pf);

  const again = el('button', 'btn primary', '再来一场');
  again.onclick = () => {
    state.screen = 'bet';
    state.settlement = null;
    state.history = [];
    state.prevKeeperDist = null;
    render();
  };
  const wrap = el('div', 'card full');
  wrap.appendChild(again);
  wrap.appendChild(
    el(
      'div',
      'disclaimer',
      '本页为开发期灰盒演示，使用模拟币，无真实货币交易。仅限 18 岁以上。' +
        '竞品差异化结论仍按待验证假设处理，竞品实测任务未完成。'
    )
  );
  root.appendChild(wrap);
}

function buildReport(s) {
  const out = [];
  const ev = s.events;
  const atk = ev.filter((e) => e.kind === 'attack');
  const scored = atk.filter((e) => e.success).length;
  out.push(`本场实际射门 <b>${scored}/${atk.length}</b>，扑救 <b>${ev.filter((e) => e.kind === 'defend' && e.success).length}/${ev.filter((e) => e.kind === 'defend').length}</b>。`);

  // 找出重复方向后的被扑
  const dirs = atk.map((e) => e.dir);
  for (let i = 1; i < atk.length; i++) {
    if (dirs[i] === dirs[i - 1] && !atk[i].success) {
      out.push(
        `你连续两次射向${DIR_LABEL[dirs[i]]}侧，第二次被扑出 —— 重复改变了门将倾向、提高了被扑概率，本次结果仍由随机分支决定。`
      );
      break;
    }
  }
  // 找出变向后的进球
  for (let i = 1; i < atk.length; i++) {
    if (dirs[i] !== dirs[i - 1] && atk[i].success && atk[i].keeperSamples >= 2) {
      out.push(
        `第 ${i + 1} 次射门你从${DIR_LABEL[dirs[i - 1]]}侧改打${DIR_LABEL[dirs[i]]}侧并进球。`
      );
      break;
    }
  }
  const peak = Math.max(...ev.map((e) => e.cashAfter));
  out.push(`本场可兑现金额最高到过 <b>${MONEY(peak)}</b>，最终结算 <b>${MONEY(s.payout)}</b>。`);
  if (s.reason === 'cashed') out.push('你在轮末主动收钱，锁定了当时的可兑现金额。');
  if (s.reason === 'loss') out.push('对手锁定胜局，按规则返还为零 —— 此前每次报价都已计入该风险。');
  return out;
}

// ---------------------------------------------------------------- 动画

// 球门框占 pitch 宽度的 10%~90%，所以三个区域中心对应 pitch 的 28% / 50% / 72%
const BALL_X = { L: '28%', C: '50%', R: '72%' };
// 门将在球门框内，坐标相对框本身
const KEEPER_X = { L: '20%', C: '50%', R: '80%' };

/**
 * 在「当前」DOM 上播放一次结果动画。
 * 必须在重新渲染之前调用 —— 重建 DOM 会丢掉初始样式，CSS 过渡就没有可插值的起点。
 */
async function animate(res) {
  const ball = document.getElementById('ball');
  const keeper = document.getElementById('keeper');
  const banner = document.getElementById('banner');
  if (!ball || !keeper || !banner) return;

  // 回到起点并强制一次重排，保证过渡有起点可插值
  ball.style.transition = 'none';
  ball.style.left = '50%';
  ball.style.bottom = '8px';
  ball.style.opacity = '1';
  void ball.offsetWidth;
  ball.style.transition = '';

  const isAttack = res.phase === 'attack';
  // 进攻：命中则门将扑错方向，被扑则扑对方向
  // 防守：res.dir 是我方扑救方向，命中(扑出)说明对手射向同侧
  const keeperDir = isAttack
    ? res.success
      ? DIRS.filter((d) => d !== res.dir)[0]
      : res.dir
    : res.dir;
  const ballDir = isAttack ? res.dir : res.success ? res.dir : DIRS.filter((d) => d !== res.dir)[0];

  await sleep(30);
  keeper.style.left = KEEPER_X[keeperDir];
  ball.style.left = BALL_X[ballDir];
  if (isAttack) {
    ball.style.bottom = res.success ? '92px' : '64px';
  } else {
    ball.style.bottom = res.success ? '52px' : '92px';
  }
  ball.style.transform = 'translateX(-50%) scale(1.15)';

  await sleep(380);
  banner.textContent = isAttack
    ? res.success
      ? '进球！'
      : '被扑出'
    : res.success
      ? '扑出了！'
      : '对手进球';
  banner.className = `banner show ${res.success ? 'good' : 'bad'}`;

  await sleep(900);
}

// ---------------------------------------------------------------- 交互

async function startMatch() {
  state.provider = new LocalProvider();
  const r = await state.provider.start({ stake: state.stake });
  state.match = r.state;
  state.quote = r.quote;
  state.info = r.info;
  state.settlement = null;
  state.history = [];
  state.prevKeeperDist = null;
  state.screen = 'play';
  render();
}

async function doSubmit(actionId, quoteId) {
  if (state.busy) return;
  state.busy = true;
  try {
    const r = await state.provider.submit(actionId, quoteId);
    const res = r.resolution;
    state.lastResolution = res;

    // 记下本次进攻时的门将倾向，下次进攻界面用它显示记忆带来的变化
    if (res.phase === 'attack' && state.quote?.keeperDist) {
      state.prevKeeperDist = { ...state.quote.keeperDist };
    }

    // 先在当前 DOM 上播完动画，再提交新状态并重绘。
    // 顺序很重要：重绘会重建球门元素，动画就没有插值起点了。
    disableOptions();
    await animate(res);

    state.match = r.state;
    state.info = r.info;
    state.quote = r.quote;

    const label =
      res.phase === 'attack'
        ? `${DIR_LABEL[res.dir]}·${SHOT_TYPES[res.shot]?.name ?? ''}`
        : `扑${DIR_LABEL[res.dir]}`;
    state.history.push(
      `<span class="${res.success ? 'g' : 'b'}">${res.success ? '○' : '×'}</span> ` +
        `${res.phase === 'attack' ? '攻' : '守'} ${label} ` +
        `${(res.probability * 100).toFixed(0)}% · ${MONEY(res.cashBefore)}→${MONEY(res.cashAfter)} · ${res.score.player}:${res.score.opp}`
    );

    if (r.settlement) {
      state.settlement = r.settlement;
      state.screen = 'settled';
    }
  } catch (e) {
    console.error(e);
    alert(`操作失败：${e.message}`);
  } finally {
    // 必须先解除 busy 再重绘：按钮的 disabled 取自 state.busy，
    // 若顺序颠倒会渲染出一屏永久禁用的按钮。
    state.busy = false;
    render();
  }
}

async function doCashOut() {
  if (state.busy) return;
  state.busy = true;
  try {
    const r = await state.provider.cashOut(state.quote.quoteId);
    state.settlement = r.settlement;
    state.match = r.state;
    state.screen = 'settled';
  } catch (e) {
    alert(`收钱失败：${e.message}`);
  } finally {
    state.busy = false;
    render();
  }
}

// 暴露给自动化验证用（不参与游戏逻辑）
window.__psc = {
  state,
  startMatch,
  submit: doSubmit,
  cashOut: doCashOut,
  getQuote: () => state.quote,
};

render();
