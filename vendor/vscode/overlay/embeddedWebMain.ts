/**
 * Embedded web main: the same `BrowserMain` service bootstrap, but composed by
 * `EmbeddedWorkbench` instead of VS Code's classic `Workbench`/`Layout`.
 *
 * `BrowserMain.createWorkbench` is the built-in seam; overriding it keeps the whole
 * service/DI bootstrap (and the extension host) intact while the embedder owns the
 * composition. The web-embedder API (`create()`) reaches this through `web.factory.ts`.
 */

import { ServiceCollection } from "../../platform/instantiation/common/serviceCollection.js";
import { ILogService } from "../../platform/log/common/log.js";
import { BrowserMain, IBrowserMainWorkbench } from "./web.main.js";
import { readEmbedBridge } from "./embedBridge.js";
import { EmbeddedWorkbench } from "./embeddedWorkbench.js";

export class EmbeddedBrowserMain extends BrowserMain {
  /**
   * Hand the embedder's construction options to the composition.
   *
   * The options parameter of this method is `IWorkbenchOptions` — only
   * `extraClasses`/`resetLayout` — so the workspace has to come from
   * `this.configuration`. Without it `resolveWorkspace()` finds no
   * `workspaceProvider` and the workbench starts as an **empty window**: every
   * workspace-scoped service (storage, configuration, profile, trust) is scoped
   * to nothing, and the only visible symptom is an empty explorer. The failure is
   * silent, which is why it is worth spelling out here.
   */
  protected override createWorkbench(
    domElement: HTMLElement,
    serviceCollection: ServiceCollection,
    logService: ILogService,
  ): IBrowserMainWorkbench {
    return new EmbeddedWorkbench(
      domElement,
      {
        configuration: this.configuration,
        // `this.configuration` *is* the environment service's `options` (the same
        // object), and it is whole here — so this is where the bridge is read.
        embedBridge: readEmbedBridge(this.configuration),
      },
      serviceCollection,
      logService,
    ) as unknown as IBrowserMainWorkbench;
  }
}
