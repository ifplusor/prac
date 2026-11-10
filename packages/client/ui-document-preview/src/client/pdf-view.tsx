/** The PDF window body: one canvas, one page, its own scroll and page state. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { openPdf, renderPdfPage, type PdfSession } from "./pdf.ts";

/** Props of one PDF window. */
export interface PdfViewProps {
  readonly path: string;
}

/**
 * Render a PDF from the workspace path.
 * @param props - the document path.
 * @returns the page canvas with paging controls.
 */
export function PdfView({ path }: PdfViewProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let session: PdfSession | undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        // The page's token is the same credential the API routes check; a
        // relative fetch does not carry it in the query by itself.
        const query = new URLSearchParams({ path });
        const token = new URLSearchParams(window.location.search).get("token");
        if (token !== null && token !== "") query.set("token", token);
        const response = await fetch(`/api/prac-file?${query.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        session = openPdf(bytes, controller.signal);
        const document = await session.document;
        if (cancelled) return;
        setPages(document.numPages);
        const canvas = canvasRef.current;
        if (canvas !== null) await renderPdfPage(document, 1, canvas, controller.signal);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      void session?.dispose();
    };
  }, [path]);

  return (
    <div
      data-prac-pdf-view={path}
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
    >
      <div
        style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 8px", fontSize: 12 }}
      >
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => {
            setPage((value) => Math.max(1, value - 1));
          }}
        >
          ‹
        </button>
        <span>
          {page} / {pages || "…"}
        </span>
        <button
          type="button"
          disabled={pages === 0 || page >= pages}
          onClick={() => {
            setPage((value) => Math.min(pages, value + 1));
          }}
        >
          ›
        </button>
        {loading && <span>loading…</span>}
        {error !== null && <span data-prac-pdf-error>{error}</span>}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        <canvas ref={canvasRef} data-prac-pdf-canvas />
      </div>
    </div>
  );
}
