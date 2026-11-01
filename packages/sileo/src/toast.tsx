import {
  type CSSProperties,
  type FocusEvent,
  type PointerEventHandler,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AUTO_COLLAPSE_DELAY,
  AUTO_EXPAND_DELAY,
  DEFAULT_TOAST_DURATION,
  EXIT_DURATION,
} from "./constants";
import { Sileo } from "./sileo";
import type { SileoDismissReason, SileoOptions, SileoPosition, SileoState } from "./types";

const pillAlign = (pos: SileoPosition) =>
  pos.includes("right") ? "right" : pos.includes("center") ? "center" : "left";
const expandDir = (pos: SileoPosition) =>
  pos.startsWith("top") ? ("bottom" as const) : ("top" as const);

/* ---------------------------------- Types --------------------------------- */

interface InternalSileoOptions extends SileoOptions {
  state?: SileoState;
}

interface SileoItem extends InternalSileoOptions {
  id: string;
  /* the shown instance: a new one on show() and on a promise result (the content swaps with its animation); update() keeps it */
  instanceId: string;
  /* the lifetime: a new one whenever a duration is set, so the time starts anew; update() without a duration keeps it */
  lifetimeId: string;
  exiting?: boolean;
  autoExpandDelayMs?: number;
  autoCollapseDelayMs?: number;
}

type SileoOffsetValue = number | string;
type SileoOffsetConfig = Partial<Record<"top" | "right" | "bottom" | "left", SileoOffsetValue>>;

export interface SileoToasterProps {
  children?: ReactNode;
  position?: SileoPosition;
  offset?: SileoOffsetValue | SileoOffsetConfig;
  options?: Partial<SileoOptions>;
  theme?: "light" | "dark" | "system";
  /** Name of the toast region(s). */
  label?: string;
  /** At most this many toasts per position at once; the rest behind a "more" button. Default: all. */
  visibleToasts?: number;
  moreLabel?: (hidden: number) => string;
  lessLabel?: string;
}

/* ------------------------------ Global State ------------------------------ */

type SileoListener = () => void;
type Announcement = { text: string; urgency: "polite" | "assertive"; seq: number };

const store = {
  toasts: [] as SileoItem[],
  announcement: null as Announcement | null,
  listeners: new Set<SileoListener>(),
  position: "top-right" as SileoPosition,
  options: undefined as Partial<SileoOptions> | undefined,

  emit() {
    for (const fn of this.listeners) fn();
  },

  update(fn: (prev: SileoItem[]) => SileoItem[]) {
    this.toasts = fn(this.toasts);
    this.emit();
  },
};

let idCounter = 0;
const generateId = () =>
  `${++idCounter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const timeoutKey = (t: SileoItem) => `${t.id}:${t.lifetimeId}`;
const liveItem = (id: string) => store.toasts.find((t) => t.id === id && !t.exiting);

let announceSeq = 0;
const announce = (text: string | false | undefined, urgency: "polite" | "assertive" = "polite") => {
  if (!text) return;
  store.announcement = { text, urgency, seq: ++announceSeq };
  store.emit();
};

/* ------------------------------- Toast API -------------------------------- */

const reportDismiss = (item: SileoItem, reason: SileoDismissReason) => {
  try {
    item.onDismiss?.(item.id, reason);
  } catch (error) {
    // a failing listener must not keep the toast or the store in a half state
    queueMicrotask(() => {
      throw error;
    });
  }
};

const dismissToast = (id: string, reason: SileoDismissReason = "programmatic") => {
  const item = liveItem(id);
  if (!item) return false;
  const instanceId = item.instanceId;

  store.update((prev) =>
    prev.map((t) => (t.id === id && t.instanceId === instanceId ? { ...t, exiting: true } : t)),
  );
  reportDismiss(item, reason);

  /* removes only this instance: a toast set again with the same id meanwhile stays */
  setTimeout(
    () =>
      store.update((prev) =>
        prev.filter((t) => !(t.id === id && t.instanceId === instanceId && t.exiting)),
      ),
    EXIT_DURATION,
  );
  return true;
};

const resolveAutopilot = (
  opts: InternalSileoOptions,
  duration: number | null,
): { expandDelayMs?: number; collapseDelayMs?: number } => {
  if (opts.autopilot === false || (duration !== null && duration <= 0)) return {};
  const cfg = typeof opts.autopilot === "object" ? opts.autopilot : undefined;
  /* a toast that stays (duration null) opens once as well, so an error or a waiting decision is seen; 0.1.6 never opened it */
  const clamp = (v: number) => (duration === null ? Math.max(0, v) : Math.min(duration, Math.max(0, v)));
  return {
    expandDelayMs: clamp(cfg?.expand ?? AUTO_EXPAND_DELAY),
    collapseDelayMs: clamp(cfg?.collapse ?? AUTO_COLLAPSE_DELAY),
  };
};

const mergeOptions = (options: InternalSileoOptions) => ({
  ...store.options,
  ...options,
  styles: { ...store.options?.styles, ...options.styles },
});

const buildSileoItem = (
  merged: InternalSileoOptions,
  id: string,
  fallbackPosition?: SileoPosition,
): SileoItem => {
  const duration = merged.duration === undefined ? DEFAULT_TOAST_DURATION : merged.duration;
  const auto = resolveAutopilot(merged, duration);
  return {
    ...merged,
    id,
    duration,
    instanceId: generateId(),
    lifetimeId: generateId(),
    position: merged.position ?? fallbackPosition ?? store.position,
    autoExpandDelayMs: auto.expandDelayMs,
    autoCollapseDelayMs: auto.collapseDelayMs,
  };
};

const createToast = (options: InternalSileoOptions) => {
  const merged = mergeOptions(options);
  const id = merged.id ?? generateId();
  const prev = liveItem(id);
  const item = buildSileoItem(merged, id, prev?.position);

  if (prev) {
    store.update((p) => p.map((t) => (t === prev ? item : t)));
  } else {
    /* a leaving toast with the same id gives way to the new one */
    store.update((p) => [...p.filter((t) => t.id !== id), item]);
  }
  announce(merged.announce === false ? false : (merged.announce ?? merged.title), merged.urgency);
  return item;
};

/* the next state of a live toast: a new instance (its content swaps with the original animation), same place */
const replaceToast = (id: string, options: InternalSileoOptions) => {
  const existing = liveItem(id);
  if (!existing) return false;
  const item = buildSileoItem(mergeOptions(options), id, existing.position);
  store.update((prev) => prev.map((t) => (t === existing ? item : t)));
  announce(options.announce === false ? false : (options.announce ?? options.title), options.urgency);
  return true;
};

/*
 * A quiet change of a live toast: same instance, no swap animation, no new entrance. The time runs on unless a duration
 * is given: then it starts anew with it (null keeps the toast until it is dismissed). An unknown, dismissed or leaving id
 * is left alone – an update never brings a closed process back.
 */
const updateToast = (id: string, patch: SileoOptions) => {
  const existing = liveItem(id);
  if (!existing) return false;
  /* the place stays: a toast moved to another viewport would enter anew (and lose a focus it holds) */
  const { type, position: _position, ...rest } = patch;
  const restarts = patch.duration !== undefined;
  const item: SileoItem = {
    ...existing,
    ...rest,
    id,
    state: type ?? existing.state,
    styles: patch.styles ? { ...existing.styles, ...patch.styles } : existing.styles,
    duration: restarts ? (patch.duration ?? null) : existing.duration,
    lifetimeId: restarts ? generateId() : existing.lifetimeId,
  };
  store.update((prev) => prev.map((t) => (t === existing ? item : t)));
  if (typeof patch.announce === "string") announce(patch.announce, patch.urgency ?? existing.urgency);
  return true;
};

export interface SileoPromiseOptions<T = unknown> {
  loading: SileoOptions;
  success: SileoOptions | ((data: T) => SileoOptions);
  error: SileoOptions | ((err: unknown) => SileoOptions);
  action?: SileoOptions | ((data: T) => SileoOptions);
  position?: SileoPosition;
}

export const sileo = {
  show: (opts: SileoOptions) => createToast({ ...opts, state: opts.type }).id,
  success: (opts: SileoOptions) => createToast({ ...opts, state: "success" }).id,
  error: (opts: SileoOptions) => createToast({ ...opts, state: "error" }).id,
  warning: (opts: SileoOptions) => createToast({ ...opts, state: "warning" }).id,
  info: (opts: SileoOptions) => createToast({ ...opts, state: "info" }).id,
  action: (opts: SileoOptions) => createToast({ ...opts, state: "action" }).id,

  /** Changes a live toast quietly; false when the id is unknown, dismissed or leaving. */
  update: (id: string, patch: SileoOptions) => updateToast(id, patch),

  promise: <T,>(
    promise: Promise<T> | (() => Promise<T>),
    opts: SileoPromiseOptions<T>,
  ): Promise<T> => {
    const created = createToast({
      ...opts.loading,
      state: "loading",
      duration: null,
      position: opts.position,
    });
    const { id } = created;
    /* the result belongs to this instance only: not to a toast set anew, dismissed or cleared meanwhile */
    const stillOurs = () => {
      const current = liveItem(id);
      return current !== undefined && current.instanceId === created.instanceId;
    };

    const p = typeof promise === "function" ? promise() : promise;

    p.then(
      (data) => {
        if (!stillOurs()) return;
        if (opts.action) {
          const actionOpts = typeof opts.action === "function" ? opts.action(data) : opts.action;
          replaceToast(id, { ...actionOpts, state: "action", id });
        } else {
          const successOpts = typeof opts.success === "function" ? opts.success(data) : opts.success;
          replaceToast(id, { ...successOpts, state: "success", id });
        }
      },
      (err) => {
        if (!stillOurs()) return;
        const errorOpts = typeof opts.error === "function" ? opts.error(err) : opts.error;
        replaceToast(id, { ...errorOpts, state: "error", id });
      },
    );

    return p;
  },

  dismiss: (id: string) => dismissToast(id, "programmatic"),

  /** Removes the toasts (of one position) at once; each reports "clear". The way to end everything, e.g. on sign-out. */
  clear: (position?: SileoPosition) => {
    const leaving = store.toasts.filter((t) => !t.exiting && (!position || t.position === position));
    store.update((prev) => (position ? prev.filter((t) => t.position !== position) : []));
    for (const item of leaving) reportDismiss(item, "clear");
  },
};

/* ------------------------------ Toaster Component ------------------------- */

const THEME_FILLS = {
  light: "#1a1a1a",
  dark: "#f2f2f2",
} as const;

function useResolvedTheme(theme: "light" | "dark" | "system" | undefined): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (theme === "light" || theme === "dark") return theme;
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      setResolved(theme);
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setResolved(e.matches ? "dark" : "light");
    setResolved(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return resolved;
}

/* an open modal: one that declares itself, an open Radix dialog (it sets no aria-modal) or a native modal dialog – visible only */
const openModals = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '[aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog:modal',
    ),
  ).filter((el) => el.getClientRects().length > 0);

/* a target the focus may go to: present, operable, not hidden from assistive technology, and not out of an open modal */
const focusable = (el: HTMLElement | null | undefined): el is HTMLElement => {
  if (!el || !el.isConnected || el.matches(":disabled")) return false;
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  return openModals().every((modal) => modal.contains(el));
};

export function Toaster({
  children,
  position = "top-right",
  offset,
  options,
  theme,
  label = "Notifications",
  visibleToasts,
  moreLabel = (hidden) => `${hidden} more`,
  lessLabel = "Show less",
}: SileoToasterProps) {
  const resolvedTheme = useResolvedTheme(theme);
  const [toasts, setToasts] = useState<SileoItem[]>(store.toasts);
  /* only announcements made after this Toaster mounted: a remount never reads an old one again */
  const mountedSeq = useRef(store.announcement?.seq ?? 0);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [activeId, setActiveId] = useState<string>();
  /* the toast holding the focus and the one under a mouse pointer – both stay shown, active and open */
  const [focusedId, setFocusedId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const heldRef = useRef<{ focused?: string; hovered?: string }>({});
  heldRef.current = { focused: focusedId, hovered: hoveredId };
  const [showAll, setShowAll] = useState<ReadonlySet<SileoPosition>>(new Set());

  const pausedByPointer = useRef(false);
  const pausedByFocus = useRef(false);
  /* running timers of this Toaster (never the global store): end time per lifetime, and the rest while paused */
  const timersRef = useRef(new Map<string, { handle: number; endsAt: number }>());
  const remainingRef = useRef(new Map<string, number>());
  const listRef = useRef(toasts);
  const latestRef = useRef<string | undefined>(undefined);
  const originRef = useRef<HTMLElement | null>(null);
  const handlersCache = useRef(
    new Map<
      string,
      {
        enter: PointerEventHandler<HTMLElement>;
        leave: PointerEventHandler<HTMLElement>;
        dismiss: () => void;
      }
    >(),
  );

  useEffect(() => {
    store.position = position;
    store.options = options;
  }, [position, options]);

  const paused = () => pausedByPointer.current || pausedByFocus.current;

  const pauseAll = useCallback(() => {
    const now = Date.now();
    for (const [key, timer] of timersRef.current) {
      clearTimeout(timer.handle);
      remainingRef.current.set(key, Math.max(0, timer.endsAt - now));
    }
    timersRef.current.clear();
  }, []);

  const schedule = useCallback((items: SileoItem[]) => {
    if (paused()) return;

    for (const item of items) {
      if (item.exiting) continue;
      const key = timeoutKey(item);
      if (timersRef.current.has(key)) continue;
      if (item.duration === null || item.duration === undefined || item.duration <= 0) continue;

      const wait = remainingRef.current.get(key) ?? item.duration;
      remainingRef.current.delete(key);
      const { id, lifetimeId } = item;
      timersRef.current.set(key, {
        endsAt: Date.now() + wait,
        handle: window.setTimeout(() => {
          timersRef.current.delete(key);
          /* only the lifetime it was started for */
          const current = liveItem(id);
          if (current && current.lifetimeId === lifetimeId) dismissToast(id, "timeout");
        }, wait),
      });
    }
  }, []);

  useEffect(() => {
    const listener: SileoListener = () => {
      setToasts(store.toasts);
      const next = store.announcement;
      if (next && next.seq > mountedSeq.current) setAnnouncement(next);
    };
    store.listeners.add(listener);
    /*
     * Re-read on subscribing, because the state above was seeded during render
     * and nothing was listening in between.
     *
     * A store write in that gap is delivered to whoever is subscribed at the
     * time, which is not yet this Toaster, so it is missed outright and the
     * stale snapshot is kept until the next unrelated write. A route change is
     * exactly that gap: the outgoing page clears the store from its cleanup
     * while the incoming Toaster has rendered but not yet subscribed, and the
     * toast it never should have had stays on screen. Re-reading costs a
     * reference comparison — React bails out when nothing moved.
     */
    setToasts(store.toasts);
    const timers = timersRef.current;
    return () => {
      store.listeners.delete(listener);
      /* unmounting ends this Toaster's own timers only; the toasts stay in the store (a remount picks them up) */
      for (const timer of timers.values()) clearTimeout(timer.handle);
      timers.clear();
    };
  }, []);

  /* the focus went to the page because the control holding it was removed (clear(), a toast pushed out): it goes on to
     the next toast or back to where it came from, and the time no longer waits for a focus that is gone */
  const focusLost = useCallback(() => {
    if (!pausedByFocus.current) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-sileo-viewport]")) return;
    if (active === null || active === document.body) handleFocusLeaveRef.current?.(undefined);
    const now = document.activeElement;
    if (now instanceof HTMLElement && now.closest("[data-sileo-viewport]")) return;
    pausedByFocus.current = false;
    setFocusedId(undefined);
    schedule(listRef.current);
  }, [schedule]);

  useEffect(() => {
    listRef.current = toasts;

    const toastKeys = new Set(toasts.map(timeoutKey));
    const liveIds = new Set(toasts.filter((t) => !t.exiting).map((t) => t.id));
    const toastIds = new Set(toasts.map((t) => t.id));
    for (const [key, timer] of timersRef.current) {
      if (!toastKeys.has(key)) {
        clearTimeout(timer.handle);
        timersRef.current.delete(key);
      }
    }
    for (const key of remainingRef.current.keys()) {
      if (!toastKeys.has(key)) remainingRef.current.delete(key);
    }
    for (const id of handlersCache.current.keys()) {
      if (!toastIds.has(id)) handlersCache.current.delete(id);
    }
    /* the toast under the pointer left without a pointerleave (closed, swiped, cleared): the pointer no longer holds the time */
    if (hoveredId !== undefined && !liveIds.has(hoveredId)) {
      setHoveredId(undefined);
      pausedByPointer.current = false;
    }

    focusLost();
    schedule(toasts);
  }, [toasts, schedule, hoveredId, focusLost]);

  const latest = useMemo(() => {
    for (let i = toasts.length - 1; i >= 0; i--) {
      if (!toasts[i].exiting) return toasts[i].id;
    }
    return undefined;
  }, [toasts]);

  /* the newest toast is the active one – unless one is in use, which a newcomer never closes */
  useEffect(() => {
    latestRef.current = latest;
    setActiveId(heldRef.current.focused ?? heldRef.current.hovered ?? latest);
  }, [latest]);

  const getHandlers = useCallback(
    (toastId: string) => {
      let cached = handlersCache.current.get(toastId);
      if (cached) return cached;

      cached = {
        /* a mouse pointer only: a tap fires pointerenter too, but has no "leave" to end the pause reliably */
        enter: ((e) => {
          if (e.pointerType !== "mouse") return;
          setActiveId(toastId);
          setHoveredId(toastId);
          if (!pausedByPointer.current) {
            pausedByPointer.current = true;
            pauseAll();
          }
        }) as PointerEventHandler<HTMLElement>,
        leave: ((e) => {
          if (e.pointerType !== "mouse") return;
          setHoveredId((prev) => (prev === toastId ? undefined : prev));
          setActiveId(heldRef.current.focused ?? latestRef.current);
          if (pausedByPointer.current) {
            pausedByPointer.current = false;
            schedule(listRef.current);
          }
        }) as PointerEventHandler<HTMLElement>,
        dismiss: () => dismissToast(toastId, "user"),
      };

      handlersCache.current.set(toastId, cached);
      return cached;
    },
    [pauseAll, schedule],
  );

  /* keyboard: focus inside a toast pauses the time like the pointer does, and keeps that toast shown and active */
  const handleFocus = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const from = e.relatedTarget;
      if (from instanceof HTMLElement && !from.closest("[data-sileo-viewport]")) originRef.current = from;
      const toast = (e.target as HTMLElement).closest<HTMLElement>("[data-sileo-toast]");
      if (toast?.dataset.id) {
        setFocusedId(toast.dataset.id);
        setActiveId(toast.dataset.id);
      }
      if (!pausedByFocus.current) {
        pausedByFocus.current = true;
        pauseAll();
      }
    },
    [pauseAll],
  );
  const handleBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const to = e.relatedTarget;
      if (to instanceof HTMLElement && to.closest("[data-sileo-viewport]")) return;
      setFocusedId(undefined);
      pausedByFocus.current = false;
      schedule(listRef.current);
    },
    [schedule],
  );

  /* a toast that loses the control holding the focus hands it to the next toast's disclosure, else back to where it came
     from – only to a target that can take it, never out of an open modal; checked after the attempt */
  const handleFocusLeave = useCallback((leavingId: string | undefined) => {
    const next = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-sileo-toast]:not([data-exiting="true"]) button[data-sileo-header]',
      ),
    ).find((el) => el.closest<HTMLElement>("[data-sileo-toast]")?.dataset.id !== leavingId && focusable(el));
    next?.focus();
    if (next && document.activeElement === next) return;
    const origin = originRef.current;
    if (focusable(origin)) origin.focus();
  }, []);
  const handleFocusLeaveRef = useRef(handleFocusLeave);
  handleFocusLeaveRef.current = handleFocusLeave;

  const getViewportStyle = useCallback(
    (pos: SileoPosition): CSSProperties | undefined => {
      if (offset === undefined) return undefined;

      const o =
        typeof offset === "object"
          ? offset
          : { top: offset, right: offset, bottom: offset, left: offset };

      const s: CSSProperties = {};
      const px = (v: SileoOffsetValue) => (typeof v === "number" ? `${v}px` : v);

      if (pos.startsWith("top") && o.top) s.top = px(o.top);
      if (pos.startsWith("bottom") && o.bottom) s.bottom = px(o.bottom);
      if (pos.endsWith("left") && o.left) s.left = px(o.left);
      if (pos.endsWith("right") && o.right) s.right = px(o.right);

      return s;
    },
    [offset],
  );

  const activePositions = useMemo(() => {
    const map = new Map<SileoPosition, SileoItem[]>();
    for (const t of toasts) {
      const pos = t.position ?? position;
      const arr = map.get(pos);
      if (arr) {
        arr.push(t);
      } else {
        map.set(pos, [t]);
      }
    }
    return map;
  }, [toasts, position]);

  /* at most visibleToasts per position (the newest), plus the one someone works with; the rest behind "more" */
  const shownOf = (pos: SileoPosition, items: SileoItem[]) => {
    const live = items.filter((t) => !t.exiting);
    if (visibleToasts === undefined || visibleToasts <= 0 || showAll.has(pos) || live.length <= visibleToasts) {
      return { shown: items, hidden: 0 };
    }
    let kept = live.slice(-visibleToasts);
    /* the toasts in use stay; the oldest of the newest give way to them */
    const held = live.filter((t) => (t.id === focusedId || t.id === hoveredId) && !kept.includes(t));
    if (held.length > 0) kept = [...held, ...kept.slice(held.length)];
    const keep = new Set(kept);
    return {
      shown: items.filter((t) => t.exiting || keep.has(t)),
      hidden: live.length - kept.length,
    };
  };

  /* polite or assertive; the same text again is still read (alternating invisible mark) */
  const announced = announcement
    ? `${announcement.text}${announcement.seq % 2 ? "" : "\u200b"}`
    : "";
  const fill = theme ? THEME_FILLS[resolvedTheme] : undefined;

  return (
    <>
      {children}
      <div data-sileo-announcer aria-live="polite" aria-atomic="true">
        {announcement?.urgency === "polite" ? announced : ""}
      </div>
      <div data-sileo-announcer aria-live="assertive" aria-atomic="true">
        {announcement?.urgency === "assertive" ? announced : ""}
      </div>
      {Array.from(activePositions, ([pos, items]) => {
        const pill = pillAlign(pos);
        const expand = expandDir(pos);
        const { shown, hidden } = shownOf(pos, items);
        const expandedAll = showAll.has(pos);

        return (
          <section
            key={pos}
            data-sileo-viewport
            data-position={pos}
            data-theme={theme ? resolvedTheme : undefined}
            aria-label={label}
            style={getViewportStyle(pos)}
            onFocus={handleFocus}
            onBlur={handleBlur}
          >
            {shown.map((item) => {
              const h = getHandlers(item.id);
              return (
                <Sileo
                  key={item.id}
                  id={item.id}
                  state={item.state}
                  title={item.title}
                  description={item.description}
                  position={pill}
                  expand={expand}
                  icon={item.icon}
                  fill={item.fill ?? fill}
                  styles={item.styles}
                  button={item.button}
                  buttons={item.buttons}
                  stateLabel={item.stateLabel}
                  dismissLabel={item.dismissLabel}
                  expandLabel={item.expandLabel}
                  roundness={item.roundness}
                  exiting={item.exiting}
                  autoExpandDelayMs={item.autoExpandDelayMs}
                  autoCollapseDelayMs={item.autoCollapseDelayMs}
                  refreshKey={item.instanceId}
                  canExpand={activeId === undefined || activeId === item.id}
                  onPointerEnter={h.enter}
                  onPointerLeave={h.leave}
                  inUse={item.id === focusedId || item.id === hoveredId}
                  onDismiss={h.dismiss}
                  onFocusLeave={handleFocusLeave}
                />
              );
            })}
            {hidden > 0 || expandedAll ? (
              <button
                type="button"
                data-sileo-more
                aria-expanded={expandedAll}
                style={fill ? ({ "--sileo-more-bg": fill, "--sileo-more-fg": resolvedTheme === "light" ? "#ffffff" : "#1a1a1a" } as CSSProperties) : undefined}
                onClick={() =>
                  setShowAll((prev) => {
                    const next = new Set(prev);
                    if (next.has(pos)) next.delete(pos);
                    else next.add(pos);
                    return next;
                  })
                }
              >
                {expandedAll ? lessLabel : moreLabel(hidden)}
              </button>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
