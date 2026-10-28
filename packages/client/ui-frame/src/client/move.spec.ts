import { describe, expect, it, vi } from "vite-plus/test";
import { moveView } from "./move.js";
import { View } from "./view.js";
import { ViewGroup } from "./viewGroup.js";
import type { MoveIntent, ViewHost } from "./contracts.js";

function host(): {
  value: ViewHost;
  mount: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const mount = vi.fn();
  const release = vi.fn();
  return { value: { mount, release, focus: vi.fn(), focusable: true }, mount, release };
}

const intent: MoveIntent = {
  fromViewGroupId: "g1",
  toViewGroupId: "g2",
  reason: "user",
};

function element(): HTMLElement {
  return {} as HTMLElement;
}

describe("moveView", () => {
  it("mounts the target before releasing the source", () => {
    const from = new ViewGroup("g1");
    const to = new ViewGroup("g2");
    const sourceHost = host();
    const targetHost = host();
    const source = new View("v1");
    source.mount(sourceHost.value, element());
    from.add(source);

    moveView({
      viewId: "v1",
      from,
      to,
      element: element(),
      intent,
      createHost: () => targetHost.value,
    });

    expect(sourceHost.release).toHaveBeenCalledOnce();
    expect(targetHost.mount).toHaveBeenCalledOnce();
    expect(to.has("v1")).toBe(true);
    expect(from.has("v1")).toBe(false);
  });

  it("leaves the source intact when target mount fails", () => {
    const from = new ViewGroup("g1");
    const to = new ViewGroup("g2");
    const sourceHost = host();
    const source = new View("v1");
    source.mount(sourceHost.value, element());
    from.add(source);

    expect(() =>
      moveView({
        viewId: "v1",
        from,
        to,
        element: element(),
        intent,
        createHost: () => ({
          mount: () => {
            throw new Error("mount failed");
          },
          release: () => {},
          focus: () => {},
          focusable: true,
        }),
      }),
    ).toThrow(/mount failed/);

    expect(sourceHost.release).not.toHaveBeenCalled();
    expect(from.has("v1")).toBe(true);
    expect(to.has("v1")).toBe(false);
  });
});
