import type { ReactNode } from "react";

export type SileoState = "success" | "loading" | "error" | "warning" | "info" | "action";

export interface SileoStyles {
  title?: string;
  description?: string;
  badge?: string;
  button?: string;
}

export interface SileoButton {
  title: string;
  onClick: () => void;
  /** Rendered but not operable, e.g. while another action of the toast runs. */
  disabled?: boolean;
  /** The action runs: not operable and marked aria-busy. */
  busy?: boolean;
}

export const SILEO_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type SileoPosition = (typeof SILEO_POSITIONS)[number];

/** Why a toast left: the user closed or swiped it, its time ran out, sileo.dismiss(), or sileo.clear(). */
export type SileoDismissReason = "user" | "timeout" | "programmatic" | "clear";

export interface SileoOptions {
  /** Identity of the process. show() with the id of a live toast replaces it in place; without an id every toast is its own. */
  id?: string;
  title?: string;
  description?: ReactNode | string;
  type?: SileoState;
  position?: SileoPosition;
  /** Milliseconds until it closes by itself; null keeps it until it is dismissed. */
  duration?: number | null;
  icon?: ReactNode | null;
  styles?: SileoStyles;
  fill?: string;
  roundness?: number;
  autopilot?: boolean | { expand?: number; collapse?: number };
  button?: SileoButton;
  /** Several actions, each its own button; `button` comes first when both are given. */
  buttons?: readonly SileoButton[];
  /** Word for the state read after the title (e.g. "Fehler"): colour and icon alone say nothing to a screen reader. */
  stateLabel?: string;
  /** Text to announce. show() announces the title unless this is false; update() announces only a text it is given. */
  announce?: string | false;
  /** "assertive" only when someone has to react now; default "polite". */
  urgency?: "polite" | "assertive";
  /**
   * Called once when the toast leaves, with the reason. Leaving says nothing about the process it shows. show() with the
   * id of a live toast and update() are no leaving: they call nothing, and without a new callback the current one stays.
   */
  onDismiss?: (id: string, reason: SileoDismissReason) => void;
  /**
   * Which toasts stay shown when `visibleToasts` limits the stack: the higher priority first, the newer one among equals
   * (default 0: the newest, as 0.1.6). The order on screen stays the order of arrival.
   */
  priority?: number;
  /** Called when someone starts (true) or stops (false) working with the toast: the focus or a mouse pointer on it. */
  onHold?: (id: string, held: boolean) => void;
  /** Accessible name of the close button beside the pill; without it the toast has none (it may still be swiped away). */
  dismissLabel?: string;
  /** Accessible name added to the disclosure that opens the description and actions, e.g. "Details". */
  expandLabel?: string;
}
