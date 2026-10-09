// 浏览器端确定性验证（零依赖，用 Node 22 内置 WebSocket 驱动 Chrome DevTools Protocol）
//
// 为什么需要它：动画只持续几百毫秒，靠人工截图碰时机不可靠。
// 本脚本在精确时刻读取 DOM 与计算样式并截图，所以「动画是否真的发生」是可判定的。
//
// 用法：node tools/browsercheck.js [url]

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8099/index.html';
const OUT = process.env.SHOT_DIR ?? '/tmp/psc-shots';
const CHROME = '/usr/local/bin/google-chrome';
const PORT = 9300 + Math.floor(Math.random() * 400);
const PROFILE = `/tmp/psc-chrome-profile-${PORT}`;

mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const results = [];
const shots = [];

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`CDP 超时：${method}`));
      }
    }, 25000);
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: `(()=>{${expr}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`页面内异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  }
  return r.result.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = `${OUT}/${name}.png`;
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  shots.push(p);
  return p;
}

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function connect() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      // 必须用独立 profile：环境里可能已有一个 Chrome 占用默认 user-data-dir
      `--user-data-dir=${PROFILE}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1280,1000',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  process.on('exit', () => { try { chrome.kill(); } catch {} });

  let url = null;
  for (let i = 0; i < 80 && !url; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      url = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
    } catch {}
  }
  if (!url) throw new Error('Chrome CDP 未就绪');

  ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      consoleErrors.push(`${d?.text ?? ''} ${d?.exception?.description ?? ''}`.trim());
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
}

async function startMatch() {
  await evaluate(`
    const bs=[...document.querySelectorAll('.stakes button')];
    (bs.find(x=>x.textContent.trim()==='10')??bs[1]).click();
    [...document.querySelectorAll('.btn')].find(x=>x.textContent.includes('开始')).click();
    return true;
  `);
}

async function desktopRun() {
  console.log(`\n打开 ${URL_}（桌面 1280×1000）\n`);
  await send('Page.navigate', { url: URL_ });
  await sleep(2600);

  const title = await evaluate('return document.title');
  check('页面加载并渲染出界面', await evaluate("return !!document.querySelector('#app .card')"), `title="${title}"`);

  await startMatch();
  await sleep(700);
  check('进入比赛界面', await evaluate("return !!document.querySelector('.pitch') && !!document.querySelector('.opt')"));

  const hud0 = await evaluate(`
    const v=[...document.querySelectorAll('.hud .val')].map(x=>x.textContent.trim());
    return {score:v[0],cash:v[1],round:v[2]};
  `);
  check('HUD 显示比分/可兑现/轮次', !!hud0.cash, JSON.stringify(hud0));
  await shot('01_match_start');

  // ---- 动画：在精确时刻采样
  const ballBefore = await evaluate("return document.getElementById('ball').style.left || '50%'");
  await evaluate(`
    const opts=[...document.querySelectorAll('.opt:not([disabled])')];
    const left=opts.find(o=>o.querySelector('.dir')?.textContent.trim()==='左');
    (left??opts[0]).click(); return true;
  `);

  await sleep(230);
  const mid = await evaluate(`
    const b=document.getElementById('ball'), k=document.getElementById('keeper');
    const br=b.getBoundingClientRect(), pr=document.querySelector('.pitch').getBoundingClientRect();
    return {ballLeftStyle:b.style.left, keeperLeftStyle:k.style.left,
            ballXRatio:+(((br.left+br.width/2)-pr.left)/pr.width).toFixed(3),
            ballLiftPx:+((pr.bottom-br.bottom)).toFixed(1), tf:b.style.transform};
  `);
  check('球的飞行动画已触发', !!mid.ballLeftStyle && mid.ballLeftStyle !== '50%',
    `ball.left ${ballBefore} -> ${mid.ballLeftStyle}；实测球心横向占比 ${mid.ballXRatio}，离底 ${mid.ballLiftPx}px`);
  check('门将扑救位置已设置', !!mid.keeperLeftStyle, `keeper.left -> ${mid.keeperLeftStyle || '(未设置)'}`);
  await shot('02_ball_in_flight');

  await sleep(320);
  const banner = await evaluate(`
    const b=document.getElementById('banner'); const cs=getComputedStyle(b);
    return {cls:b.className, text:b.textContent, opacity:cs.opacity, fontSize:cs.fontSize, color:cs.color};
  `);
  const bannerOk = banner.cls.includes('show') && Number(banner.opacity) > 0.9 && banner.text.length > 0;
  check('结果横幅可见', bannerOk,
    `text="${banner.text}" opacity=${banner.opacity} fontSize=${banner.fontSize} color=${banner.color}`);
  await shot('03_result_banner');

  await sleep(950);
  const after = await evaluate(`
    const v=[...document.querySelectorAll('.hud .val')].map(x=>x.textContent.trim());
    return {cash:v[1], hist:document.querySelectorAll('.log div').length};
  `);
  check('结果写入本场记录并推进阶段', after.hist > 0, JSON.stringify(after));

  // ---- 持续打完一局：观察涨跌与记忆指示
  let sawUp = false, sawDown = false, sawDelta = null, steps = 0;
  let prev = parseFloat(after.cash);
  while (steps < 20) {
    steps++;
    if (await evaluate("return !!document.querySelector('.result .big')")) break;
    const clicked = await evaluate(`
      const opts=[...document.querySelectorAll('.opt:not([disabled])')];
      if(!opts.length) return false;
      const left=opts.find(o=>o.querySelector('.dir')?.textContent.trim()==='左');
      (left??opts[0]).click(); return true;
    `);
    if (!clicked) { await sleep(400); continue; }
    await sleep(1550);
    const c = await evaluate(`
      const v=[...document.querySelectorAll('.hud .val')].map(x=>x.textContent.trim());
      const d=document.querySelector('.tend .delta');
      return {cash:v[1], delta:d?d.textContent.trim():null, ended:!!document.querySelector('.result .big')};
    `);
    if (c.delta && !sawDelta) sawDelta = c.delta;
    const cash = parseFloat(c.cash);
    if (!Number.isNaN(cash) && !Number.isNaN(prev)) {
      if (cash > prev + 1e-9) sawUp = true;
      if (cash < prev - 1e-9) sawDown = true;
    }
    prev = cash;
    if (c.ended) break;
  }
  check('可兑现金额出现上升', sawUp);
  check('可兑现金额出现下降（现金可降，无损区间不成立的直接体现）', sawDown);
  check('门将倾向出现 ▲▼ 变化指示（记忆对玩家可见）', !!sawDelta, sawDelta ? `示例 "${sawDelta}"` : '未捕获');

  if (await evaluate("return !!document.querySelector('.result .big')")) {
    const s = await evaluate(`
      return {amount:document.querySelector('.result .big').textContent.trim(),
              why:document.querySelector('.result .why')?.textContent.trim(),
              items:document.querySelectorAll('.report li').length,
              proof:(document.querySelector('.proof')?.textContent??'').replace(/\\s+/g,' ').slice(0,90)};
    `);
    check('结算页显示金额与原因', !!s.amount, `${s.amount} · ${s.why}`);
    check('战报有条目', s.items > 0, `${s.items} 条`);
    check('可验证性区块含承诺值与 seed', s.proof.includes('commitment'), s.proof);
    await shot('04_settlement');
  } else {
    check('一局内完成结算', false, `${steps} 步后仍未结算`);
  }
}

async function mobileRun() {
  console.log('\n切换到移动端竖屏 390×844\n');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await send('Page.navigate', { url: URL_ });
  await sleep(2400);
  await startMatch();
  await sleep(800);

  const m = await evaluate(`
    const opts=[...document.querySelectorAll('.opt')];
    return {hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
            scrollW: document.documentElement.scrollWidth, winW: window.innerWidth,
            optCount: opts.length,
            minOptH: opts.length?Math.min(...opts.map(o=>Math.round(o.getBoundingClientRect().height))):0,
            pitch: !!document.querySelector('.pitch')};
  `);
  check('移动端竖屏无横向滚动', !m.hScroll, `scrollWidth=${m.scrollW} viewport=${m.winW}`);
  check('移动端动作按钮高度可点击（≥44px）', m.minOptH >= 44, `最小 ${m.minOptH}px，共 ${m.optCount} 个`);

  await evaluate(`
    const o=[...document.querySelectorAll('.opt:not([disabled])')]; o[0] && o[0].click(); return true;
  `);
  await sleep(600);
  const mb = await evaluate(`
    const b=document.getElementById('banner');
    return {cls:b.className, text:b.textContent, opacity:getComputedStyle(b).opacity};
  `);
  check('移动端横幅同样可见', mb.cls.includes('show') && Number(mb.opacity) > 0.9, `"${mb.text}"`);
  await shot('05_mobile_portrait');
}

(async () => {
  try {
    await connect();
    await desktopRun();
    await mobileRun();

    console.log('\n--- Console 错误 ---');
    if (consoleErrors.length === 0) console.log('  无');
    else for (const e of consoleErrors) console.log(`  ${e}`);
    check('Console 无错误', consoleErrors.length === 0, `${consoleErrors.length} 条`);

    console.log('\n--- 截图 ---');
    for (const s of shots) console.log(`  ${s}`);

    const failed = results.filter((r) => !r.passed);
    console.log(`\n结果：${results.length - failed.length}/${results.length} 项通过`);
    if (failed.length) {
      console.log('失败项：');
      for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error('\n验证脚本异常：', e.message);
    process.exit(1);
  }
})();
