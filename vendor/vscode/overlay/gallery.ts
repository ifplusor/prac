/**
 * The extension gallery, as data — **one source for both planes**.
 *
 * The OSS `product.json` ships no gallery, and the client's product configuration
 * (which the embedder hands the workbench) is a *different* copy from the server's
 * `product.json`. Without both, the product's own install path
 * (`workbench.extensions.installExtension`) answers "No extension gallery service
 * configured" — measured, and the reason this file exists. The build script reads
 * it (Node imports this module directly) to stamp the server's copies, and the
 * client passes it in its construction options.
 *
 * @module prac-vscode/overlay/gallery
 */

/** The public VS Code marketplace endpoints. */
export const EXTENSIONS_GALLERY = {
  serviceUrl: "https://marketplace.visualstudio.com/_apis/public/gallery",
  cacheUrl: "https://vscode.blob.core.windows.net/gallery/index",
  itemUrl: "https://marketplace.visualstudio.com/items",
  publisherUrl: "https://marketplace.visualstudio.com/publishers",
  resourceUrlTemplate: "https://{publisher}.vscode-unpkg.net/{publisher}/{name}/{version}/{path}",
} as const;
