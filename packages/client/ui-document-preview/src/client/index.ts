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

/** The app declaration: one app, many windows. */
const app: PracAppDef = {
  id: "prac.document-preview",
  version: "1",
  label: "Document",
  instances: "multi",
  paneHeader: true,
};

/**
 * Register the document-preview app.
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  const documents: DocumentWindow[] = [];
  const extension: PracExtension = {
    manifest: { id: "prac.document-preview", origin: "prac", version: "1" },
    apps: () => [app],
    windows: () => documents.map((document) => ({ id: document.id, title: document.title })),
    contentFor: (windowId: string): (() => ReactNode) => {
      const document = documents.find((candidate) => candidate.id === windowId);
      return () => (document === undefined ? null : DocumentPlaceholder(document));
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
export const inject = ["pracExtensions"];
