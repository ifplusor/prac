/**
 * Runtime registry for window content hosts.
 *
 * A `ViewRecord` may name a `contentId`; the actual renderer is a `ContentHost`
 * registered here, not a generic `FrameView`. This is the first seam of the
 * frame renderer rewrite: windows can own editor / chat / board content without
 * going through the slot/`FrameView` path.
 *
 * @module prac-client-ui-frame/client/contentHosts
 */
import type { ContentHost } from "./windowModel.js";

/** Content-id → host registry for one frame. */
export class ContentHostRegistry {
  readonly #hosts = new Map<string, ContentHost>();

  register(contentId: string, host: ContentHost): () => void {
    this.#hosts.set(contentId, host);
    return () => {
      if (this.#hosts.get(contentId) === host) this.#hosts.delete(contentId);
    };
  }

  get(contentId: string): ContentHost | undefined {
    return this.#hosts.get(contentId);
  }

  delete(contentId: string): void {
    this.#hosts.delete(contentId);
  }
}
