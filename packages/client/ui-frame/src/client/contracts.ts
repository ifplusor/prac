/**
 * Runtime contracts shared by the frame and its source adapters.
 *
 * The authoritative shapes live in `prac-ui-kit`; this module keeps the frame's
 * historical import path stable while the plugin is migrated.
 *
 * @module prac-client-ui-frame/client/contracts
 */

export type {
  GroupAction,
  GroupActionBinding,
  GroupBinding,
  MoveIntent,
  ViewHost,
  ViewRuntime,
} from "prac-ui-kit";
