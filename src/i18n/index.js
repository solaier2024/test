import { CATALOG } from "./messages.js";

export const LOCALE_KEY = "last-kick-locale-v1";
export const LOCALES = Object.freeze(["en", "es"]);
export function chooseLocale(saved, browserLanguage = "en") {
  return LOCALES.includes(saved)
    ? saved
    : String(browserLanguage).toLowerCase().startsWith("es")
      ? "es"
      : "en";
}
let saved = null;
try {
  saved = globalThis.localStorage?.getItem(LOCALE_KEY);
} catch {
  /* Language switching still works without persistent storage. */
}
let locale = chooseLocale(saved, globalThis.navigator?.language);
const listeners = new Set();
const aliases = new Map();
const patterns = [];
const descriptors = new Map();
const nodeSources = new WeakMap();
const attributeSources = new WeakMap();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const [key, values] of Object.entries(CATALOG)) {
  for (const format of [key, values.en, values.es]) {
    if (!/\{\d+\}/.test(format)) {
      if (!aliases.has(format)) aliases.set(format, key);
      continue;
    }
    if (format.includes("<")) continue;
    const indices = [];
    let start = 0,
      regex = "^";
    for (const match of format.matchAll(/\{(\d+)\}/g)) {
      regex += escapeRegex(format.slice(start, match.index)) + "(.*?)";
      indices.push(Number(match[1]));
      start = match.index + match[0].length;
    }
    regex += escapeRegex(format.slice(start)) + "$";
    patterns.push({ key, indices, regex: new RegExp(regex, "u") });
  }
}
function describe(source) {
  if (descriptors.has(source)) return descriptors.get(source);
  let result = null;
  if (CATALOG[source]) result = { key: source, args: [] };
  else if (aliases.has(source)) result = { key: aliases.get(source), args: [] };
  else {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(source);
      if (!match) continue;
      const args = [];
      pattern.indices.forEach((index, i) => (args[index] = match[i + 1]));
      result = { key: pattern.key, args };
      break;
    }
  }
  if (descriptors.size >= 512)
    descriptors.delete(descriptors.keys().next().value);
  descriptors.set(source, result);
  return result;
}
function format(key, args, depth = 0) {
  const value = CATALOG[key]?.[locale] ?? key;
  return value.replace(/\{(\d+)\}/g, (_, i) =>
    depth >= 6
      ? String(args[i] ?? "")
      : translateValue(args[i] ?? "", depth + 1),
  );
}
function translateValue(value, depth = 0) {
  const source = String(value ?? "");
  const description = describe(source);
  if (description) return format(description.key, description.args, depth);
  return /[\p{Script=Han}]/u.test(source)
    ? CATALOG["Information unavailable"][locale]
    : source;
}
export function tr(source, ...args) {
  if (source == null) return source;
  if (Array.isArray(source) && source.raw) {
    const key = source
      .map((part, i) => part + (i < args.length ? `{${i}}` : ""))
      .join("");
    return format(key, args);
  }
  if (args.length) return format(String(source), args);
  return translateValue(source);
}
export const getLocale = () => locale;
export const pressureLabel = (level) =>
  tr(["Low", "Medium", "High"][level] ?? "Low");
export const directionLetter = (dir) =>
  locale === "es" ? { L: "I", C: "C", R: "D" }[dir] : dir;
export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setLocale(next) {
  if (!LOCALES.includes(next) || next === locale) return false;
  locale = next;
  try {
    globalThis.localStorage?.setItem(LOCALE_KEY, locale);
  } catch {
    /* Do not couple language preferences to match or career persistence. */
  }
  for (const listener of listeners) listener(locale);
  return true;
}

// Translate existing dialog nodes in place, preserving unsaved lineup edits,
// selected coach slots, focus, scroll position and expanded rules.
export function translateDom(root) {
  const document = root.ownerDocument ?? root;
  const walker = document.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      node.parentElement?.closest("script, style, code, option[data-language]")
    )
      continue;
    const source = nodeSources.get(node) ?? node.nodeValue;
    const key = source.trim();
    if (!describe(key)) continue;
    nodeSources.set(node, source);
    node.nodeValue = source.replace(key, tr(key));
  }
  for (const element of root.querySelectorAll(
    "[aria-label], [title], [placeholder]",
  )) {
    const sources = attributeSources.get(element) ?? new Map();
    for (const name of ["aria-label", "title", "placeholder"]) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name);
      const previous = sources.get(name);
      const source = previous?.rendered === current ? previous.source : current;
      if (!describe(source)) continue;
      const rendered = tr(source);
      sources.set(name, { source, rendered });
      element.setAttribute(name, rendered);
    }
    attributeSources.set(element, sources);
  }
}
