import { describe, expect, it } from "vite-plus/test";
import {
  ResourceStateStore,
  ViewDefinitionRegistry,
  ViewGroupDefinitionRegistry,
  ViewGroupMaterializer,
  ViewMaterializer,
  type ViewDefinition,
  type ViewGroupDefinition,
  type ViewGroupResource,
  type ViewResource,
} from "./resource.js";
import { View } from "./view.js";
import { ViewGroup } from "./viewGroup.js";

const groupDefinition: ViewGroupDefinition = {
  apiVersion: "test/v1",
  kind: "ViewGroup",
  validate: (spec) => spec as Record<string, unknown>,
  materialize: (decl) => new ViewGroup(decl.metadata.id),
};

const viewDefinition: ViewDefinition = {
  apiVersion: "test/v1",
  kind: "View",
  validate: (spec) => spec as Record<string, unknown>,
  materialize: (decl) => new View(decl.metadata.id),
  hostFactory: () => ({
    mount: () => {},
    release: () => {},
    focus: () => {},
    focusable: true,
  }),
};

const group: ViewGroupResource = {
  apiVersion: "test/v1",
  kind: "ViewGroup",
  metadata: { id: "g1" },
  spec: {},
};

const view: ViewResource = {
  apiVersion: "test/v1",
  kind: "View",
  metadata: { id: "v1" },
  spec: {},
};

describe("resource materializer / runtime", () => {
  it("materializes the core ViewGroup and View runtimes", async () => {
    const states = new ResourceStateStore();
    const groups = new ViewGroupDefinitionRegistry();
    const views = new ViewDefinitionRegistry();
    groups.register(groupDefinition);
    views.register(viewDefinition);

    const groupMaterializer = new ViewGroupMaterializer(groups, undefined, states);
    const viewMaterializer = new ViewMaterializer(views, undefined, states);

    const groupRecord = await groupMaterializer.materialize(group, "owner-1");
    const viewRecord = await viewMaterializer.materialize(view, "owner-1");

    expect(groupRecord.value).toBeInstanceOf(ViewGroup);
    expect(viewRecord.value).toBeInstanceOf(View);
    expect(viewDefinition.hostFactory(view).focusable).toBe(true);
  });
});
