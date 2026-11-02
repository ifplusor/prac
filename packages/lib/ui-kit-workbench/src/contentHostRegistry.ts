/**
 * Runtime registry for window content hosts.
 *
 * A `ItemRecord` may name a `contentId`; the actual renderer is a `ContentHost`
 * registered here. Windows can own editor / chat / board content without going
 * through the generic slot path.
 *
 * @module prac-ui-kit-workbench/contentHostRegistry
 */
import type { ContentHost } from "prac-ui-kit-content";

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
