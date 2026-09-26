/**
 * The character and room plates live in the public directory, so Vite does not
 * rewrite their URLs at build time and they have to be resolved against the
 * base path the app is served from. The preview runs on a GitHub Pages project
 * site, which is a sub-path rather than the domain root.
 */
export const plateUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png`
