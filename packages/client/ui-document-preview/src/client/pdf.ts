/**
 * A thin PDF renderer over `pdfjs-dist`.
 *
 * The renderer is a capability, not a sidebar slot: one instance per document
 * window, disposed with the window. It deliberately does not import the DSH
 * document-preview package, because that package's body is shaped as a
 * `sidebar.right.tab.document` slot and cannot serve multiple windows.
 *
 * @module prac-client-ui-document-preview/pdf
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
// No worker is configured yet: the pack pipeline cannot carry the pdfjs worker
// asset and the app has no static root shared by the dev server and the gate rig.
// The PDF view reports the resulting load error instead of pretending to render.

/** One loaded PDF and its cleanup. */
export interface PdfSession {
  readonly document: Promise<PDFDocumentProxy>;
  dispose(): Promise<void>;
}

/**
 * Load complete PDF bytes with an owned worker.
 * @param data - the complete PDF bytes.
 * @param signal - the window's lifetime.
 * @returns the pending document and its cleanup.
 */
export function openPdf(data: Uint8Array<ArrayBuffer>, signal: AbortSignal): PdfSession {
  // Loaded lazily: the document-preview bundle must not pay pdfjs on boot.
  const taskPromise = import("pdfjs-dist").then((pdfjs) => pdfjs.getDocument({ data }));
  signal.addEventListener(
    "abort",
    () => {
      void taskPromise.then((task) => task.destroy());
    },
    { once: true },
  );
  return {
    document: taskPromise.then((task) => task.promise),
    async dispose(): Promise<void> {
      const task = await taskPromise;
      await task.destroy();
    },
  };
}

/**
 * Render one page into an exclusively owned canvas.
 * @param document - the loaded PDF.
 * @param pageNumber - 1-based page number.
 * @param canvas - the canvas to paint.
 * @param signal - the render lifetime.
 * @param scale - the zoom factor.
 * @returns the page's CSS dimensions.
 */
export async function renderPdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  scale = 1.5,
): Promise<{ width: number; height: number }> {
  const page: PDFPageProxy = await document.getPage(pageNumber);
  if (signal.aborted) return { width: 0, height: 0 };
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext("2d");
  if (context === null) return { width: viewport.width, height: viewport.height };
  await page.render({
    canvasContext: context,
    viewport,
    canvas,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  }).promise;
  return { width: viewport.width, height: viewport.height };
}
