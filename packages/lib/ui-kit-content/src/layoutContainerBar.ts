/**
 * Generic container bar.
 *
 * A selector region shows one child at a time; this bar lists the children and
 * the active child's actions. Labels / actions / selection are supplied by the
 * container, so frame and board share the DOM without sharing policy.
 *
 * @module prac-ui-kit-content/layoutContainerBar
 */
import { createElement } from "react";
import type { CSSProperties, ReactElement } from "react";

const BAR: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  height: 22,
  boxSizing: "border-box",
  flex: "0 0 auto",
  overflow: "hidden",
  background: "rgba(127,127,127,0.10)",
};

const ITEM: CSSProperties = {
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  height: 22,
  boxSizing: "border-box",
  padding: "4px 10px",
  border: "none",
  borderRight: "1px solid rgba(127,127,127,0.22)",
  background: "transparent",
  color: "inherit",
  opacity: 0.7,
  cursor: "pointer",
  whiteSpace: "nowrap",
  maxWidth: "220px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flex: "0 0 auto",
};

const ACTIVE: CSSProperties = {
  opacity: 1,
  background: "rgba(127,127,127,0.22)",
  boxShadow: "inset 0 -1px 0 rgba(127,127,127,0.9)",
};

/** One child shown by a container bar. */
export interface ContainerBarItem {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly empty: boolean;
}

/** One action shown at the bar's right end. */
export interface ContainerBarAction {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly tooltip?: string;
}

/** Inputs for one container bar. */
export interface ContainerBarProps {
  readonly containerId: string;
  readonly label: string;
  readonly items: readonly ContainerBarItem[];
  readonly actionKey: string;
  readonly actions: readonly ContainerBarAction[];
  readonly onSelect: (itemId: string) => void;
  readonly onAction: (actionId: string) => void;
}

/** Render a selector region's container bar. */
export function ContainerBar({
  containerId,
  label,
  items,
  actionKey,
  actions,
  onSelect,
  onAction,
}: ContainerBarProps): ReactElement {
  return createElement(
    "div",
    {
      key: "containers",
      "data-prac-container-bar": containerId,
      role: "tablist",
      "aria-label": label,
      "aria-orientation": "horizontal",
      style: BAR,
    },
    items.map((item) =>
      createElement(
        "button",
        {
          key: item.id,
          type: "button",
          "data-prac-container": item.id,
          "data-prac-container-active": item.active ? "true" : "false",
          role: "tab",
          "aria-selected": item.active ? "true" : "false",
          tabIndex: item.active ? 0 : -1,
          "aria-label": item.label,
          "data-prac-container-empty": item.empty ? "true" : "false",
          ...(item.empty ? { title: "Nothing in this container yet" } : {}),
          onClick: () => onSelect(item.id),
          style: {
            ...ITEM,
            ...(item.active ? ACTIVE : {}),
            ...(item.empty ? { opacity: 0.55 } : {}),
          },
        },
        item.label,
      ),
    ),
    createElement(
      "div",
      {
        key: "actions",
        "data-prac-container-actions": actionKey,
        "data-prac-container-action-bar": actionKey,
        style: { display: "flex", alignItems: "center", flex: "0 0 auto", height: "100%" },
      },
      actions.map((action) =>
        createElement(
          "button",
          {
            key: action.id,
            type: "button",
            "data-prac-group-action": action.id,
            title: action.tooltip ?? action.label,
            disabled: !action.enabled,
            onClick: () => onAction(action.id),
            style: {
              font: "inherit",
              fontSize: "11px",
              height: "100%",
              padding: "0 5px",
              border: 0,
              background: "transparent",
              color: "inherit",
              cursor: action.enabled ? "pointer" : "default",
              opacity: action.enabled ? 1 : 0.55,
            },
          },
          action.label,
        ),
      ),
    ),
  );
}
