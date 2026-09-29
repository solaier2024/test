/**
 * The opening cinematic plays once per browser profile and then remembers it
 * has. A fresh Playwright profile has never seen it, so every capture script
 * that wants the title card would otherwise open on eleven seconds of film.
 * Seeding the flag before the first navigation is cheaper and steadier than
 * hunting for the skip button.
 */
export const SEEN_INTRO = 'lastround.intro'

export const skipIntro = (target) =>
  target.addInitScript((key) => localStorage.setItem(key, '1'), SEEN_INTRO)
