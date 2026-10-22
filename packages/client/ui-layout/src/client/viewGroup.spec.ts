import { describe, expect, it, vi } from "vite-plus/test";
import { View } from "./view.js";
import { ViewGroup } from "./viewGroup.js";
import type { ViewHost } from "./resource.js";

function element(): HTMLElement {
  return {} as HTMLElement;
}

function host(): {
  value: ViewHost;
  mount: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
} {
  const mount = vi.fn();
  const release = vi.fn();
  const focus = vi.fn();
  return {
    value: { mount, release, focus, focusable: true },
    mount,
    release,
    focus,
  };
}

function view(id: string): View {
  return new View(id);
}

describe("View", () => {
  it("mounts and releases a host explicitly", () => {
    const value = view("v1");
    const h = host();
    const box = element();

    value.mount(h.value, box);
    value.focus();
    value.release();

    expect(h.mount).toHaveBeenCalledWith(box);
    expect(h.focus).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("rejects a second mount without release", () => {
    const value = view("v1");
    value.mount(host().value, element());

    expect(() => value.mount(host().value, element())).toThrow(/already mounted/);
  });
});

describe("ViewGroup", () => {
  it("tracks order and active view", () => {
    const group = new ViewGroup("g1", "select");
    group.add(view("v1"));
    group.add(view("v2"));

    expect(group.state.order).toEqual(["v1", "v2"]);
    expect(group.state.active).toBe("v1");

    group.select("v2");
    expect(group.state.active).toBe("v2");
  });

  it("does not expose active on a stack group", () => {
    const group = new ViewGroup("g1", "stack");
    group.add(view("v1"));

    expect(group.state.active).toBeUndefined();
    expect(() => group.select("v1")).toThrow(/stack group/);
  });

  it("reorders only its members", () => {
    const group = new ViewGroup("g1", "stack");
    group.add(view("v1"));
    group.add(view("v2"));

    group.reorder(["v2", "v1"]);
    expect(group.state.order).toEqual(["v2", "v1"]);
    expect(() => group.reorder(["v1"])).toThrow(/length/);
    expect(() => group.reorder(["v1", "v3"])).toThrow(/unknown/);
  });

  it("replaces and disposes the group binding", () => {
    const group = new ViewGroup("g1");
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    group.setBinding({ dispose: firstDispose });
    group.setBinding({ dispose: secondDispose });
    group.setBinding(undefined);

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
  });

  it("releases hosts and binding on dispose", () => {
    const group = new ViewGroup("g1");
    const value = view("v1");
    const h = host();
    const bindingDispose = vi.fn();
    value.mount(h.value, element());
    group.add(value);
    group.setBinding({ dispose: bindingDispose });

    group.dispose();

    expect(h.release).toHaveBeenCalledOnce();
    expect(bindingDispose).toHaveBeenCalledOnce();
    expect(() => group.add(view("v2"))).toThrow(/disposed/);
  });
});
