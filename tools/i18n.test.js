import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsers } from "prettier/plugins/babel";
import { CATALOG } from "../src/i18n/messages.js";
import {
  chooseLocale,
  getLocale,
  setLocale,
  tr,
  pressureLabel,
  directionLetter,
  LOCALE_KEY,
  onLocaleChange,
} from "../src/i18n/index.js";
import {
  PLAYERS,
  CUP_STAGES,
  QUICK_POLICY,
  pressureAt,
} from "../src/math/depth.js";
import { ARCHETYPES, keeperHint } from "../src/math/keeper.js";
import { initialMatch } from "../src/math/rules.js";
import { ACHIEVEMENTS, KITS } from "../src/shell/progress.js";
import { ShootoutEngine } from "../src/math/engine.js";
import { verifySettlement } from "../src/math/replay.js";

const han = /\p{Script=Han}/u;
const placeholders = (value) =>
  [...value.matchAll(/\{(\d+)\}/g)]
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
const translated = (source) => {
  const result = tr(source);
  assert.ok(result && !han.test(result), `Untranslated: ${source}`);
  assert.ok(
    !result.includes(tr("Information unavailable")),
    `Missing translation: ${source}`,
  );
  return result;
};

test("both catalog languages retain the same interpolation values and contain no Chinese", () => {
  for (const [key, values] of Object.entries(CATALOG)) {
    assert.ok(values.en && values.es, key);
    assert.ok(!han.test(values.en) && !han.test(values.es), key);
    assert.deepEqual(placeholders(values.en), placeholders(values.es), key);
    if (placeholders(key).length)
      assert.deepEqual(placeholders(key), placeholders(values.en), key);
  }
});

test("every explicit UI translation key exists in the catalog", async () => {
  const files = [
    "src/ui/app.js",
    "src/ui/depth-panels.js",
    "src/presentation/hud.js",
    "src/presentation/entrance.js",
    "src/presentation/video-match.js",
    "src/shell/progress.js",
  ];
  const missing = [];
  for (const file of files) {
    const ast = parsers.babel.parse(
      await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
    );
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      let key;
      if (
        node.type === "CallExpression" &&
        node.callee?.name === "tr" &&
        node.arguments[0]?.type === "StringLiteral"
      )
        key = node.arguments[0].value;
      if (node.type === "TaggedTemplateExpression" && node.tag?.name === "tr")
        key = node.quasi.quasis
          .map(
            (part, i) =>
              part.value.cooked +
              (i < node.quasi.expressions.length ? `{${i}}` : ""),
          )
          .join("");
      if (key && !CATALOG[key]) missing.push(`${file}: ${key}`);
      for (const [name, value] of Object.entries(node)) {
        if (
          [
            "loc",
            "comments",
            "leadingComments",
            "trailingComments",
            "extra",
            "tokens",
          ].includes(name)
        )
          continue;
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    };
    visit(ast);
  }
  assert.deepEqual(missing, []);
});

test("language defaults use saved preferences and Spanish browser locales", () => {
  assert.equal(chooseLocale("en", "es-MX"), "en");
  assert.equal(chooseLocale("es", "en-US"), "es");
  assert.equal(chooseLocale("zh", "es-ES"), "es");
  assert.equal(chooseLocale(null, "zh-CN"), "en");
  assert.equal(chooseLocale(null, undefined), "en");
});

test("switching stores only a language preference and tolerates unavailable storage", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const writes = [],
    changes = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: (...args) => writes.push(args) },
  });
  setLocale("en");
  writes.length = 0;
  const unsubscribe = onLocaleChange((value) => changes.push(value));
  assert.equal(setLocale("es"), true);
  assert.equal(setLocale("es"), false);
  assert.equal(setLocale("zh"), false);
  assert.deepEqual(writes, [[LOCALE_KEY, "es"]]);
  assert.deepEqual(changes, ["es"]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: () => {
        throw new Error("storage disabled");
      },
    },
  });
  assert.equal(setLocale("en"), true);
  assert.equal(getLocale(), "en");
  unsubscribe();
  if (previous) Object.defineProperty(globalThis, "localStorage", previous);
  else delete globalThis.localStorage;
});

test("canonical journal labels, dynamic keeper hints and joined values switch in both directions", () => {
  for (const language of ["en", "es"]) {
    setLocale(language);
    for (const group of [
      PLAYERS,
      CUP_STAGES,
      Object.values(ARCHETYPES),
      ACHIEVEMENTS,
      KITS,
    ])
      for (const data of group)
        for (const value of Object.values(data))
          if (typeof value === "string" && han.test(value)) translated(value);
    translated(QUICK_POLICY.desc);
    const pressure = pressureAt(
      { ...initialMatch(), playerTaken: 4, round: 5, oppGoals: 2 },
      2,
    );
    pressure.sources.forEach(translated);
    translated(pressure.recovery);
    for (const dir of ["L", "C", "R"]) {
      const dist = { L: 0.15, C: 0.15, R: 0.15, [dir]: 0.7 };
      translated(keeperHint(dist, { samples: 0 }));
      translated(keeperHint(dist, { samples: 4 }));
    }
    translated(keeperHint({ L: 0.34, C: 0.32, R: 0.34 }, { samples: 5 }));
    translated(tr`${tr(PLAYERS[0].name)}射门`);
    assert.equal(pressureLabel(1), language === "en" ? "Medium" : "Media");
    assert.equal(tr("中"), language === "en" ? "Centre" : "Centro");
    assert.equal(directionLetter("L"), language === "en" ? "L" : "I");
    assert.equal(directionLetter("R"), language === "en" ? "R" : "D");
    assert.equal(tr(null), null);
    assert.equal(tr(undefined), undefined);
  }
  setLocale("en");
  const joined =
    `✓ ${tr(ACHIEVEMENTS[0].name)}` + " · " + tr("左") + " → " + tr("右");
  setLocale("es");
  const spanish = translated(joined);
  assert.ok(
    spanish.includes("Izquierda") && spanish.includes("Derecha"),
    spanish,
  );
  setLocale("en");
  assert.equal(tr(spanish), joined);
});

test("language switching preserves quotes, accepted results, settlement and replay authority", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const a = new ShootoutEngine({
    stake: 10,
    seed: "locale-authority",
    config: { enableChip: true },
  });
  const b = new ShootoutEngine({
    stake: 10,
    seed: "locale-authority",
    config: { enableChip: true },
  });
  let n = 0;
  while (!a.getSettlement()) {
    const before = a.getQuote();
    setLocale(n++ % 2 ? "en" : "es");
    translated(before.player.name);
    translated(before.keeperHint ?? "扑救");
    assert.strictEqual(a.getQuote(), before);
    assert.deepEqual(a.getQuote(), b.getQuote());
    const action = before.options.reduce((x, y) => (x.p >= y.p ? x : y));
    assert.deepEqual(
      a.submit(action.id, before.quoteId),
      b.submit(action.id, b.getQuote().quoteId),
    );
    assert.deepEqual(a.getState(), b.getState());
  }
  assert.deepEqual(a.getSettlement(), b.getSettlement());
  assert.ok(verifySettlement(a.getSettlement()));
  setLocale("en");
  assert.ok(verifySettlement(a.getSettlement()));
});
