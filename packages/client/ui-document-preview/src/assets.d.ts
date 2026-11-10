/** Vite's `?url` imports resolve to the emitted asset's URL. */
declare module "*?url" {
  const url: string;
  export default url;
}

/** Vite's `?raw` imports resolve to the file's text. */
declare module "*?raw" {
  const text: string;
  export default text;
}
