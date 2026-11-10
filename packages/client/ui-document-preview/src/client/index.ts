/**
 * prac-client-ui-document-preview — the document preview application.
 *
 * One **app** (`prac.document-preview`) with one window per open document. The
 * app's content is the DSH document preview body: office, pdf, image and text
 * share the same window shape, and the app decides nothing about placement —
 * the arrangement puts a document where a window goes.
 *
 * The documents this app owns are opened through prac's open router, not through
 * a VS Code editor adapter: the router hands the app the resource and the
 * preview kind, and the app admits a window.
 *
 * @module prac-client-ui-document-preview/client
 */

import type { Context } from "@deepseek-ai/cordis";
import { createElement, type ReactNode } from "react";
import { PdfView } from "./pdf-view.tsx";
// Type-only, for the frame plugin's `Context` / `SlotMap` merges.
import type {} from "prac-client-ui-frame/client";
import type { PracAppDef, PracExtension, PracExtensionsFace } from "prac-client-ui-frame/client";

/** One document the app has open. */
export interface DocumentWindow {
  /** Stable window id (`prac.document-preview:<path>`). */
  readonly id: string;
  /** The document's workspace path. */
  readonly path: string;
  /** The tab title. */
  readonly title: string;
  /** The preview kind, chosen by the router. */
  readonly kind: "office" | "pdf" | "image" | "text";
}

/** The preview kind the resource implies. */
function kindOf(path: string): DocumentWindow["kind"] {
  if (/\.pdf$/iu.test(path)) return "pdf";
  if (/\.(png|jpe?g|gif|webp|svg)$/iu.test(path)) return "image";
  if (/\.(docx?|xlsx?|pptx?)$/iu.test(path)) return "office";
  return "text";
}

/** The window id the open uses; the path is encoded in it. */
const WINDOW_PREFIX = "prac.document-preview:";

/**
 * Register the document-preview app.
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  const windows = ctx.pracWindows;
  const frame = ctx.pracFrame;
  // The window manager owns the windows; the app derives its documents from them
  // instead of keeping a second list. The window id encodes the path.
  const documents = (): DocumentWindow[] =>
    windows
      .ids()
      .filter((windowId) => windows.appOf(windowId) === app.id)
      .map((windowId) => {
        const path = windowId.slice(WINDOW_PREFIX.length);
        return { id: windowId, path, title: windows.titleOf(windowId) ?? path, kind: kindOf(path) };
      });
  const app: PracAppDef = {
    id: "prac.document-preview",
    version: "1",
    label: "Document",
    instances: "multi",
    paneHeader: true,
    defaultRegion: "center",
    match: (resource: string): boolean =>
      /\.(docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|webp|svg)$/iu.test(resource),
    // Opening is complete when the window exists: the app keeps no document list,
    // and the frame derives the item from the window manager.
    open: (resource: string): boolean => {
      const name = resource.split("/").at(-1) ?? resource;
      const windowId = `${WINDOW_PREFIX}${resource}`;
      windows.admit(app.id, { windowId, title: name, region: app.defaultRegion });
      if (app.defaultRegion !== undefined) frame.place(windowId, app.defaultRegion);
      return true;
    },
  };
  const extension: PracExtension = {
    manifest: { id: "prac.document-preview", origin: "prac", version: "1" },
    apps: () => [app],
    windows: () => documents().map((document) => ({ id: document.id, title: document.title })),
    contentFor: (windowId: string): (() => ReactNode) => {
      const document = documents().find((candidate) => candidate.id === windowId);
      if (document === undefined) return () => null;
      if (document.kind === "pdf") return () => createElement(PdfView, { path: document.path });
      return () => DocumentPlaceholder(document);
    },
  };
  ctx.effect(
    () => extensions.register(extension),
    "prac-client-ui-document-preview: app + windows",
  );
}

/**
 * The placeholder body: the window proves the app/window registration until the
 * DSH preview body is wired in.
 */
function DocumentPlaceholder(document: DocumentWindow): ReactNode {
  return createElement(
    "div",
    { "data-prac-document-preview": document.path, "data-preview-kind": document.kind },
    document.path,
  );
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-document-preview";

/** The DSH services this plugin needs: the app + window faces. */
export const inject = ["pracExtensions", "pracWindows", "pracFrame"];
