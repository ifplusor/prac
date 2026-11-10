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

import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
/** The worker source, inlined by the build (a Blob URL keeps it off the network). */
declare const __PRAC_PDF_WORKER__: string;

/** One Blob URL shared by every PDF window in the page. */
const workerUrl =
  typeof __PRAC_PDF_WORKER__ === "string"
    ? URL.createObjectURL(new Blob([__PRAC_PDF_WORKER__], { type: "text/javascript" }))
    : undefined;

if (workerUrl !== undefined) GlobalWorkerOptions.workerSrc = workerUrl;

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
  // Static import: a dynamic one would emit a separate chunk the DSH module
  // table does not know, which fails at the require.
  const task = getDocument({ data });
  signal.addEventListener(
    "abort",
    () => {
      void task.destroy();
    },
    { once: true },
  );
  return {
    document: task.promise,
    async dispose(): Promise<void> {
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
