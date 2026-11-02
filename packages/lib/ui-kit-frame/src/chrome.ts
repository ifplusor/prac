/**
 * Chrome contracts, re-exported from `prac-ui-kit-content`.
 *
 * The frame once owned them; they are geometry-independent and now live in the
 * content layer so a window-content renderer can use them without the frame.
 *
 * @module prac-ui-kit-frame/chrome
 */

export {
  ChromeRegistry,
  type ChromeAnchor,
  type ChromeContext,
  type ChromeContribution,
  type ChromeItemFacts,
  type ChromeMetrics,
  type ChromeSlotFace,
  type LayoutIntents,
} from "prac-ui-kit-content";
