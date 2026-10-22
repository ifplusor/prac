import { describe, expect, it, vi } from "vite-plus/test";
import {
  MATERIALIZE_PENDING,
  ViewDefinitionRegistry,
  ViewGroupDefinitionRegistry,
  ViewGroupMaterializer,
  ViewMaterializer,
  ResourceStateStore,
  type Diagnostic,
  type GroupBinding,
  type ViewDefinition,
  type ViewGroupDefinition,
  type ViewGroupResource,
  type ViewGroupRuntime,
  type ViewResource,
  type ViewRuntime,
} from "./resource.js";

function groupRuntime(): ViewGroupRuntime {
  return { dispose: vi.fn() };
}

function viewRuntime(): ViewRuntime {
  return { dispose: vi.fn() };
}

function groupDefinition(overrides: Partial<ViewGroupDefinition> = {}): ViewGroupDefinition {
  return {
    apiVersion: "test/v1",
    kind: "ViewGroup",
    validate: (spec) => spec as Record<string, unknown>,
    materialize: () => groupRuntime(),
    ...overrides,
  };
}

function viewDefinition(overrides: Partial<ViewDefinition> = {}): ViewDefinition {
  return {
    apiVersion: "test/v1",
    kind: "View",
    validate: (spec) => spec as Record<string, unknown>,
    materialize: () => viewRuntime(),
    hostFactory: () => ({
      mount: () => {},
      release: () => {},
      focus: () => {},
      focusable: true,
    }),
    ...overrides,
  };
}

function groupResource(id: string, spec: Record<string, unknown> = {}): ViewGroupResource {
  return {
    apiVersion: "test/v1",
    kind: "ViewGroup",
    metadata: { id },
    spec,
  };
}

function viewResource(id: string, groupId?: string): ViewResource {
  return {
    apiVersion: "test/v1",
    kind: "View",
    metadata: { id },
    spec: groupId ? { groupId } : {},
  };
}

describe("resource registries", () => {
  it("keeps view group and view categories separate", () => {
    const groups = new ViewGroupDefinitionRegistry();
    const views = new ViewDefinitionRegistry();
    groups.register(groupDefinition());

    expect(groups.lookup("test/v1", "ViewGroup")).toBeDefined();
    expect(views.lookup("test/v1", "ViewGroup")).toBeUndefined();
  });

  it("rejects duplicate definitions", () => {
    const groups = new ViewGroupDefinitionRegistry();
    groups.register(groupDefinition());

    expect(() => groups.register(groupDefinition())).toThrow(/already registered/);
  });
});

describe("resource materializer", () => {
  it("materializes a group and a view", async () => {
    const groups = new ViewGroupDefinitionRegistry();
    groups.register(groupDefinition());
    const materializer = new ViewGroupMaterializer(groups);

    const record = await materializer.materialize(groupResource("g1"), "owner-1");

    expect(record.phase).toBe("ready");
    expect(record.value).toBeDefined();
    expect(record.ownerId).toBe("owner-1");
  });

  it("waits for a dependency and retries when it becomes ready", async () => {
    const groups = new ViewGroupDefinitionRegistry();
    groups.register(groupDefinition());
    const views = new ViewDefinitionRegistry();
    views.register(
      viewDefinition({
        dependencies: (decl) => {
          const groupId = decl.spec["groupId"];
          return typeof groupId === "string" ? [groupId] : [];
        },
      }),
    );
    const states = new ResourceStateStore();
    const groupMaterializer = new ViewGroupMaterializer(groups, undefined, states);
    const viewMaterializer = new ViewMaterializer(views, undefined, states);

    const waiting = await viewMaterializer.materialize(viewResource("v1", "g1"), "owner-1");
    expect(waiting.phase).toBe("waiting");

    await groupMaterializer.materialize(groupResource("g1"), "owner-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(viewMaterializer.get("v1")?.phase).toBe("ready");
  });

  it("supports async materialize", async () => {
    const groups = new ViewGroupDefinitionRegistry();
    groups.register(
      groupDefinition({
        materialize: async () => groupRuntime(),
      }),
    );
    const materializer = new ViewGroupMaterializer(groups);

    const record = await materializer.materialize(groupResource("g1"), "owner-1");

    expect(record.phase).toBe("ready");
    expect(record.value).toBeDefined();
  });

  it("keeps a failed resource isolated", async () => {
    const diagnostics: Diagnostic[] = [];
    const groups = new ViewGroupDefinitionRegistry();
    groups.register(
      groupDefinition({
        materialize: (decl) => {
          if (decl.metadata.id === "bad") throw new Error("boom");
          return groupRuntime();
        },
      }),
    );
    const materializer = new ViewGroupMaterializer(groups, (diagnostic) =>
      diagnostics.push(diagnostic),
    );

    const bad = await materializer.materialize(groupResource("bad"), "owner-1");
    const good = await materializer.materialize(groupResource("good"), "owner-1");

    expect(bad.phase).toBe("failed");
    expect(bad.error?.code).toBe("materialize-failed");
    expect(good.phase).toBe("ready");
    expect(diagnostics).toHaveLength(1);
  });

  it("disposes all resources owned by one source scope", async () => {
    const groups = new ViewGroupDefinitionRegistry();
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const first: ViewGroupRuntime = { dispose: firstDispose };
    const second: ViewGroupRuntime = { dispose: secondDispose };
    let index = 0;
    groups.register(
      groupDefinition({
        materialize: () => (index++ === 0 ? first : second),
      }),
    );
    const materializer = new ViewGroupMaterializer(groups);

    await materializer.materialize(groupResource("g1"), "owner-1");
    await materializer.materialize(groupResource("g2"), "owner-1");
    await materializer.materialize(groupResource("g3"), "owner-2");

    materializer.releaseOwner("owner-1");

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(materializer.get("g1")).toBeUndefined();
    expect(materializer.get("g2")).toBeUndefined();
    expect(materializer.get("g3")?.phase).toBe("ready");
  });

  it("marks a pending result as waiting", async () => {
    const groups = new ViewGroupDefinitionRegistry();
    groups.register(
      groupDefinition({
        materialize: (decl, ctx): ViewGroupRuntime | typeof MATERIALIZE_PENDING => {
          if (decl.metadata.id === "pending") {
            ctx.whenReady("runtime", () => {});
            return MATERIALIZE_PENDING;
          }
          return groupRuntime();
        },
      }),
    );
    const materializer = new ViewGroupMaterializer(groups);

    const record = await materializer.materialize(groupResource("pending"), "owner-1");
    expect(record.phase).toBe("waiting");
  });

  it("exposes the binding factory without making it a group runtime", () => {
    const binding: GroupBinding = { dispose: vi.fn() };
    const definition = groupDefinition({ bindingFactory: () => binding });
    const groups = new ViewGroupDefinitionRegistry();
    groups.register(definition);

    expect(groups.lookup("test/v1", "ViewGroup")?.bindingFactory?.({})).toBe(binding);
  });
});
