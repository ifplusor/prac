/**
 * The runtime side of one view.
 *
 * A view resource materializes into a `View`; the view owns its `ViewHost`
 * boundary but not the placement or the view group record. Host lifecycle is
 * explicit: `mount` is not activation, and `release` is not disposal of the
 * source-owned identity.
 *
 * @module prac-client-ui-layout/client/view
 */

import type { MoveIntent, ViewHost, ViewRuntime } from "./resource.js";

/** A materialized view runtime. */
export class View implements ViewRuntime {
  #host: ViewHost | undefined;

  constructor(readonly id: string) {}

  /** The currently mounted host, if any. */
  get host(): ViewHost | undefined {
    return this.#host;
  }

  /** Mount a host into the frame-provided element. */
  mount(host: ViewHost, element: HTMLElement): void {
    if (this.#host) throw new Error(`view already mounted: ${this.id}`);
    host.mount(element);
    this.#host = host;
  }

  /** Release the host without disposing the view identity. */
  release(): void {
    const host = this.#host;
    this.#host = undefined;
    host?.release();
  }

  /** Move-hint hook for hosts that can preserve their runtime. */
  move(host: ViewHost, element: HTMLElement, _intent: MoveIntent): void {
    this.release();
    this.mount(host, element);
  }

  /** Ask the host to take focus when it supports it. */
  focus(): void {
    this.#host?.focus();
  }

  /** Release the host; the materializer owns final disposition of the view. */
  dispose(): void {
    this.release();
  }
}
