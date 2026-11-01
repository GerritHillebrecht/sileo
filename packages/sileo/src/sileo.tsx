import { motion, useReducedMotion, useReducedMotionConfig } from "motion/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEventHandler,
  memo,
  type ReactNode,
  type TransitionEventHandler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BLUR_RATIO,
  DEFAULT_ROUNDNESS,
  HEADER_EXIT_MS,
  HEIGHT,
  MIN_EXPAND_RATIO,
  PILL_PADDING,
  SPRING,
  SWAP_COLLAPSE_MS,
  WIDTH,
} from "./constants";
import { ArrowRight, Check, CircleAlert, LifeBuoy, LoaderCircle, X } from "./icons";
import "./styles.css";
import type { SileoButton, SileoState, SileoStyles } from "./types";

type State = SileoState;

interface View {
  title?: string;
  description?: ReactNode | string;
  state: State;
  icon?: ReactNode | null;
  styles?: SileoStyles;
  button?: SileoButton;
  buttons?: readonly SileoButton[];
  fill: string;
}

interface SileoProps {
  id: string;
  fill?: string;
  state?: State;
  title?: string;
  description?: ReactNode | string;
  position?: "left" | "center" | "right";
  expand?: "top" | "bottom";
  className?: string;
  icon?: ReactNode | null;
  styles?: SileoStyles;
  button?: SileoButton;
  buttons?: readonly SileoButton[];
  stateLabel?: string;
  dismissLabel?: string;
  expandLabel?: string;
  roundness?: number;
  exiting?: boolean;
  autoExpandDelayMs?: number;
  autoCollapseDelayMs?: number;
  canExpand?: boolean;
  interruptKey?: string;
  refreshKey?: string;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  /* the Toaster's view: the focus or a mouse pointer is on this toast */
  inUse?: boolean;
  onDismiss?: () => void;
  /* the toast lost the control holding the focus (it leaves, or the control went): the Toaster moves the focus on */
  onFocusLeave?: (id: string) => void;
}

/* ---------------------------------- Icons --------------------------------- */

const STATE_ICON: Record<State, ReactNode> = {
  success: <Check />,
  loading: <LoaderCircle data-sileo-icon="spin" aria-hidden="true" />,
  error: <X />,
  warning: <CircleAlert />,
  info: <LifeBuoy />,
  action: <ArrowRight />,
};

const REGION_SIGMA = 2;

const GooeyDefs = memo(function GooeyDefs({
  filterId,
  blur,
  width,
  height,
}: {
  filterId: string;
  blur: number;
  width: number;
  height: number;
}) {
  const margin = blur * REGION_SIGMA;
  return (
    <defs>
      <filter
        id={filterId}
        filterUnits="userSpaceOnUse"
        x={-margin}
        y={-margin}
        width={width + margin * 2}
        height={height + margin * 2}
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10"
          result="goo"
        />
        <feComposite in="SourceGraphic" in2="goo" operator="atop" />
      </filter>
    </defs>
  );
});

/* ------------------------------- Component -------------------------------- */

export const Sileo = memo(function Sileo({
  id,
  fill = "#FFFFFF",
  state = "success",
  title = state,
  description,
  position = "left",
  expand = "bottom",
  className,
  icon,
  styles,
  button,
  buttons,
  stateLabel,
  dismissLabel,
  expandLabel,
  roundness,
  exiting = false,
  autoExpandDelayMs,
  autoCollapseDelayMs,
  canExpand,
  interruptKey,
  refreshKey,
  onPointerEnter,
  onPointerLeave,
  inUse = false,
  onDismiss,
  onFocusLeave,
}: SileoProps) {
  const next: View = useMemo(
    () => ({ title, description, state, icon, styles, button, buttons, fill }),
    [title, description, state, icon, styles, button, buttons, fill],
  );
  /* reduced motion – the user's setting, or forced by a MotionConfig above (reducedMotion="always"): no spring, no shape
     morph, no gooey filter; the CSS transitions are cut in styles.css (media query, and data-reduced-motion when forced) */
  const userReduced = useReducedMotion() ?? false;
  const reduced = useReducedMotionConfig() || userReduced;

  const [view, setView] = useState<View>(next);
  const [applied, setApplied] = useState(refreshKey);
  const [isExpanded, setIsExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [pillWidth, setPillWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  /* working with the toast: pointer or focus inside; an explicit open/close of the disclosure wins while it lasts */
  const [hovered, setHovered] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const interacting = hovered || focusInside || inUse;
  const actions = useMemo(
    () => [...(view.button ? [view.button] : []), ...(view.buttons ?? [])],
    [view.button, view.buttons],
  );
  const hasDesc = Boolean(view.description) || actions.length > 0;
  const isLoading = view.state === "loading";
  const open = hasDesc && !isLoading && (userOpen ?? (isExpanded || focusInside));
  const contentId = `sileo-content-${id}`;
  const allowExpand = isLoading ? false : (canExpand ?? (!interruptKey || interruptKey === id));

  const headerKey = `${view.state}-${view.title}`;
  const filterId = `sileo-gooey-${id}`;
  const resolvedRoundness = Math.max(0, roundness ?? DEFAULT_ROUNDNESS);
  const blur = resolvedRoundness * BLUR_RATIO;

  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerExitRef = useRef<number | null>(null);
  const autoExpandRef = useRef<number | null>(null);
  const autoCollapseRef = useRef<number | null>(null);
  const swapTimerRef = useRef<number | null>(null);
  const lastRefreshKeyRef = useRef(refreshKey);
  const pendingRef = useRef<{ key?: string; payload: View } | null>(null);
  const [headerLayer, setHeaderLayer] = useState<{
    current: { key: string; view: View };
    prev: { key: string; view: View } | null;
  }>({ current: { key: headerKey, view }, prev: null });

  /* ------------------------------ Measurements ------------------------------ */

  const innerRef = useRef<HTMLDivElement>(null);

  const headerPadRef = useRef<number | null>(null);

  const pillRoRef = useRef<ResizeObserver | null>(null);
  const pillRafRef = useRef(0);
  const pillObservedRef = useRef<Element | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: headerLayer.current.key is used to force a re-render
  useLayoutEffect(() => {
    const el = innerRef.current;
    const header = headerRef.current;
    if (!el || !header) return;
    if (headerPadRef.current === null) {
      const cs = getComputedStyle(header);
      headerPadRef.current = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    }
    const px = headerPadRef.current;
    const measure = () => {
      const w = el.scrollWidth + px + PILL_PADDING;
      if (w > PILL_PADDING) {
        setPillWidth((prev) => (prev === w ? prev : w));
      }
    };
    measure();

    if (!pillRoRef.current) {
      pillRoRef.current = new ResizeObserver(() => {
        cancelAnimationFrame(pillRafRef.current);
        pillRafRef.current = requestAnimationFrame(() => {
          const inner = innerRef.current;
          const pad = headerPadRef.current ?? 0;
          if (!inner) return;
          const w = inner.scrollWidth + pad + PILL_PADDING;
          if (w > PILL_PADDING) {
            setPillWidth((prev) => (prev === w ? prev : w));
          }
        });
      });
    }

    if (pillObservedRef.current !== el) {
      if (pillObservedRef.current) {
        pillRoRef.current.unobserve(pillObservedRef.current);
      }
      pillRoRef.current.observe(el);
      pillObservedRef.current = el;
    }
  }, [headerLayer.current.key]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(pillRafRef.current);
      pillRoRef.current?.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (!hasDesc) {
      setContentHeight(0);
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.scrollHeight;
      setContentHeight((prev) => (prev === h ? prev : h));
    };
    measure();
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [hasDesc]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useLayoutEffect(() => {
    setHeaderLayer((state) => {
      if (state.current.key === headerKey) {
        if (state.current.view === view) return state;
        return { ...state, current: { key: headerKey, view } };
      }
      return {
        prev: state.current,
        current: { key: headerKey, view },
      };
    });
  }, [headerKey, view]);

  useEffect(() => {
    if (!headerLayer.prev) return;
    if (headerExitRef.current) {
      clearTimeout(headerExitRef.current);
    }
    headerExitRef.current = window.setTimeout(() => {
      headerExitRef.current = null;
      setHeaderLayer((state) => ({ ...state, prev: null }));
    }, HEADER_EXIT_MS);
    return () => {
      if (headerExitRef.current) {
        clearTimeout(headerExitRef.current);
        headerExitRef.current = null;
      }
    };
  }, [headerLayer.prev]);

  /* ----------------------------- Sync fill ---------------------------------- */

  useEffect(() => {
    setView((prev) => (prev.fill === fill ? prev : { ...prev, fill }));
  }, [fill]);

  /* ----------------------------- Refresh logic ------------------------------ */

  useEffect(() => {
    if (refreshKey === undefined) {
      setView(next);
      setApplied(undefined);
      pendingRef.current = null;
      lastRefreshKeyRef.current = refreshKey;
      return;
    }

    /* the same instance changed (sileo.update): take the content as it is, no collapse, no swap */
    if (lastRefreshKeyRef.current === refreshKey) {
      if (pendingRef.current) pendingRef.current.payload = next;
      else setView((prev) => (prev === next ? prev : next));
      return;
    }
    lastRefreshKeyRef.current = refreshKey;

    if (swapTimerRef.current) {
      clearTimeout(swapTimerRef.current);
      swapTimerRef.current = null;
    }

    /* a new instance swaps with the original collapse-then-change – never while someone works with the toast */
    if (open && !interacting) {
      pendingRef.current = { key: refreshKey, payload: next };
      setIsExpanded(false);
      swapTimerRef.current = window.setTimeout(() => {
        swapTimerRef.current = null;
        const pending = pendingRef.current;
        if (!pending) return;
        setView(pending.payload);
        setApplied(pending.key);
        pendingRef.current = null;
      }, SWAP_COLLAPSE_MS);
    } else {
      pendingRef.current = null;
      setView(next);
      setApplied(refreshKey);
    }
  }, [open, interacting, refreshKey, next]);

  /* ----------------------------- Auto expand/collapse ----------------------- */

  // biome-ignore lint/correctness/useExhaustiveDependencies: applied is used to force a re-render
  useEffect(() => {
    if (!hasDesc) return;

    if (autoExpandRef.current) clearTimeout(autoExpandRef.current);
    if (autoCollapseRef.current) clearTimeout(autoCollapseRef.current);

    if (exiting || !allowExpand) {
      if (exiting || !interactingRef.current) setIsExpanded(false);
      return;
    }

    if (autoExpandDelayMs == null && autoCollapseDelayMs == null) return;
    /* once per instance: becoming the active toast again (another one hovered and left) does not open it anew */
    if (autoOpenedForRef.current === applied) return;
    autoOpenedForRef.current = applied;

    const expandDelay = autoExpandDelayMs ?? 0;
    const collapseDelay = autoCollapseDelayMs ?? 0;

    if (expandDelay > 0) {
      autoExpandRef.current = window.setTimeout(() => setIsExpanded(true), expandDelay);
    } else {
      setIsExpanded(true);
    }

    if (collapseDelay > 0) {
      autoCollapseRef.current = window.setTimeout(() => {
        if (!interactingRef.current) setIsExpanded(false);
      }, collapseDelay);
    }

    return () => {
      if (autoExpandRef.current) clearTimeout(autoExpandRef.current);
      if (autoCollapseRef.current) clearTimeout(autoCollapseRef.current);
    };
  }, [autoCollapseDelayMs, autoExpandDelayMs, hasDesc, allowExpand, exiting, applied]);

  const interactingRef = useRef(interacting);
  interactingRef.current = interacting;
  const autoOpenedForRef = useRef<string | undefined | null>(null);

  /* the disclosure's explicit choice lasts while the toast is in use */
  useEffect(() => {
    if (!interacting) setUserOpen(null);
  }, [interacting]);

  /* ------------------------------ Derived values ---------------------------- */

  const minExpanded = HEIGHT * MIN_EXPAND_RATIO;
  const rawExpanded = hasDesc ? Math.max(minExpanded, HEIGHT + contentHeight) : minExpanded;

  const frozenExpandedRef = useRef(rawExpanded);
  if (open) {
    frozenExpandedRef.current = rawExpanded;
  }

  const expanded = open ? rawExpanded : frozenExpandedRef.current;
  const svgHeight = hasDesc ? Math.max(expanded, minExpanded) : HEIGHT;
  const expandedContent = Math.max(0, expanded - HEIGHT);
  const resolvedPillWidth = Math.max(pillWidth || HEIGHT, HEIGHT);
  const pillHeight = HEIGHT + blur * 3;

  const pillX =
    position === "right"
      ? WIDTH - resolvedPillWidth
      : position === "center"
        ? (WIDTH - resolvedPillWidth) / 2
        : 0;

  /* ------------------------------- Memoised animate targets ----------------- */

  const pillAnimate = useMemo(
    () => ({
      x: pillX,
      width: resolvedPillWidth,
      height: open ? pillHeight : HEIGHT,
    }),
    [pillX, resolvedPillWidth, open, pillHeight],
  );

  const bodyAnimate = useMemo(
    () => ({
      height: open ? expandedContent : 0,
      opacity: open ? 1 : 0,
    }),
    [open, expandedContent],
  );

  const bodyTransition = useMemo(
    () => (reduced ? { duration: 0 } : open ? SPRING : { ...SPRING, bounce: 0 }),
    [open, reduced],
  );

  const pillTransition = useMemo(() => (ready && !reduced ? SPRING : { duration: 0 }), [ready, reduced]);

  const viewBox = `0 0 ${WIDTH} ${svgHeight}`;

  /* ------------------------------- Inline styles ---------------------------- */

  const rootStyle = useMemo<CSSProperties & Record<string, string>>(
    () => ({
      "--_h": `${open ? expanded : HEIGHT}px`,
      "--_pw": `${resolvedPillWidth}px`,
      "--_px": `${pillX}px`,
      "--_ht": `translateY(${open ? (expand === "bottom" ? 3 : -3) : 0}px) scale(${open ? 0.9 : 1})`,
      "--_co": `${open ? 1 : 0}`,
    }),
    [open, expanded, resolvedPillWidth, pillX, expand],
  );

  /* -------------------------------- Handlers -------------------------------- */

  /* hover is a mouse thing: a tap opens the card through the disclosure, not through a pointer that never leaves */
  const handleEnter: PointerEventHandler<HTMLElement> = useCallback(
    (e) => {
      onPointerEnter?.(e);
      if (e.pointerType !== "mouse") return;
      setHovered(true);
      if (hasDesc) setIsExpanded(true);
    },
    [hasDesc, onPointerEnter],
  );

  const handleLeave: PointerEventHandler<HTMLElement> = useCallback(
    (e) => {
      onPointerLeave?.(e);
      if (e.pointerType !== "mouse") return;
      setHovered(false);
      setIsExpanded(false);
    },
    [onPointerLeave],
  );

  const handleTransitionEnd: TransitionEventHandler<HTMLElement> = useCallback(
    (e) => {
      if (e.propertyName !== "height" && e.propertyName !== "transform") return;
      if (open) return;
      const pending = pendingRef.current;
      if (!pending) return;
      if (swapTimerRef.current) {
        clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }
      setView(pending.payload);
      setApplied(pending.key);
      pendingRef.current = null;
    },
    [open],
  );

  /* the disclosure: opens or closes the description and actions (keyboard, tap); the choice lasts while it is in use */
  const handleToggle = useCallback(() => {
    if (open) {
      setUserOpen(false);
      setIsExpanded(false);
    } else {
      setUserOpen(true);
    }
  }, [open]);

  /* Escape closes the open card from inside this toast only, never a key someone else (a dialog, a menu) handled */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Escape" || !open || e.defaultPrevented) return;
      if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
      e.preventDefault();
      /* the card becomes inert: a focus inside it goes to the disclosure first */
      if (cardRef.current?.contains(document.activeElement)) headerRef.current?.focus();
      setUserOpen(false);
      setIsExpanded(false);
    },
    [open],
  );

  /* -------------------------------- Swipe ----------------------------------- */

  const SWIPE_DISMISS = 30;
  const SWIPE_MAX = 20;
  /* movement before the pointer is captured, so a tap on the disclosure stays a click */
  const SWIPE_CAPTURE = 4;
  const buttonRef = useRef<HTMLDivElement>(null);
  /* the card (description, actions, close button): inert while closed */
  const cardRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const swipeHandlersRef = useRef<{
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  } | null>(null);

  if (!swipeHandlersRef.current) {
    const handlers = {
      onMove: (e: PointerEvent) => {
        const el = buttonRef.current;
        if (pointerStartRef.current === null || !el) return;
        const dy = e.clientY - pointerStartRef.current;
        if (Math.abs(dy) > SWIPE_CAPTURE && !el.hasPointerCapture(e.pointerId)) {
          el.setPointerCapture(e.pointerId);
        }
        const sign = dy > 0 ? 1 : -1;
        const clamped = Math.min(Math.abs(dy), SWIPE_MAX) * sign;
        el.style.transform = `translateY(${clamped}px)`;
      },
      onUp: (e: PointerEvent) => {
        const el = buttonRef.current;
        if (pointerStartRef.current === null || !el) return;
        const dy = e.clientY - pointerStartRef.current;
        pointerStartRef.current = null;
        el.style.transform = "";
        el.removeEventListener("pointermove", handlers.onMove);
        el.removeEventListener("pointerup", handlers.onUp);
        if (Math.abs(dy) > SWIPE_DISMISS) {
          onDismissRef.current?.();
        }
      },
    };
    swipeHandlersRef.current = handlers;
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (exiting || !onDismiss) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-sileo-button], [data-sileo-close]")) return;
      pointerStartRef.current = e.clientY;
      const el = buttonRef.current;
      const h = swipeHandlersRef.current;
      if (el && h) {
        el.addEventListener("pointermove", h.onMove, { passive: true });
        el.addEventListener("pointerup", h.onUp, { passive: true });
      }
    },
    [exiting, onDismiss],
  );

  /* the control holding the focus went away (removed by an update, the card closed into inert, the disclosure became a
     plain header): the focus goes to the disclosure when there is one, else the Toaster moves it on */
  useLayoutEffect(() => {
    if (!focusInside || exiting) return;
    const root = buttonRef.current;
    const active = document.activeElement;
    if (root && active instanceof Node && root.contains(active) && !(active as HTMLElement).closest("[inert]")) return;
    const header = headerRef.current;
    if (header instanceof HTMLButtonElement && header.isConnected) header.focus();
    else onFocusLeave?.(id);
    if (!(root && document.activeElement instanceof Node && root.contains(document.activeElement))) setFocusInside(false);
  }, [view, open, hasDesc, exiting, focusInside, id, onFocusLeave]);

  /* a toast that leaves while it holds the focus hands it on before it becomes inert */
  useLayoutEffect(() => {
    if (!exiting) return;
    const active = document.activeElement;
    if (active instanceof Node && buttonRef.current?.contains(active)) onFocusLeave?.(id);
  }, [exiting, id, onFocusLeave]);

  /* --------------------------------- Render --------------------------------- */

  const headerContent = (
    <>
      <div data-sileo-header-stack>
        <div
          ref={innerRef}
          key={headerLayer.current.key}
          data-sileo-header-inner
          data-layer="current"
        >
          <div
            data-sileo-badge
            data-state={headerLayer.current.view.state}
            className={headerLayer.current.view.styles?.badge}
            aria-hidden="true"
          >
            {headerLayer.current.view.icon ?? STATE_ICON[headerLayer.current.view.state]}
          </div>
          <span
            data-sileo-title
            data-state={headerLayer.current.view.state}
            className={headerLayer.current.view.styles?.title}
          >
            {headerLayer.current.view.title}
          </span>
        </div>
        {headerLayer.prev && (
          <div
            key={headerLayer.prev.key}
            data-sileo-header-inner
            data-layer="prev"
            data-exiting="true"
            aria-hidden="true"
          >
            <div
              data-sileo-badge
              data-state={headerLayer.prev.view.state}
              className={headerLayer.prev.view.styles?.badge}
            >
              {headerLayer.prev.view.icon ?? STATE_ICON[headerLayer.prev.view.state]}
            </div>
            <span
              data-sileo-title
              data-state={headerLayer.prev.view.state}
              className={headerLayer.prev.view.styles?.title}
            >
              {headerLayer.prev.view.title}
            </span>
          </div>
        )}
      </div>
      {/* read after the title, outside the measured pill so its width stays the original */}
      {stateLabel ? <span data-sileo-sr>, {stateLabel}</span> : null}
      {hasDesc && expandLabel ? <span data-sileo-sr>, {expandLabel}</span> : null}
    </>
  );

  return (
    <div
      ref={buttonRef}
      role="group"
      aria-label={view.title}
      data-sileo-toast
      data-id={id}
      data-ready={ready}
      data-expanded={open}
      data-exiting={exiting}
      data-edge={expand}
      data-position={position}
      data-state={view.state}
      data-reduced-motion={reduced || undefined}
      inert={exiting || undefined}
      className={className}
      style={rootStyle}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onFocus={() => setFocusInside(true)}
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setFocusInside(false);
      }}
      onKeyDown={handleKeyDown}
      onTransitionEnd={handleTransitionEnd}
      onPointerDown={handlePointerDown}
    >
      <div data-sileo-canvas data-edge={expand} aria-hidden="true">
        <svg data-sileo-svg width={WIDTH} height={svgHeight} viewBox={viewBox} aria-hidden="true" focusable="false">
          {reduced ? null : (
            <GooeyDefs filterId={filterId} blur={blur} width={WIDTH} height={svgHeight} />
          )}
          <g filter={reduced ? undefined : `url(#${filterId})`}>
            <motion.rect
              data-sileo-pill
              rx={resolvedRoundness}
              ry={resolvedRoundness}
              fill={view.fill}
              initial={false}
              animate={pillAnimate}
              transition={pillTransition}
            />
            <motion.rect
              data-sileo-body
              y={HEIGHT}
              width={WIDTH}
              rx={resolvedRoundness}
              ry={resolvedRoundness}
              fill={view.fill}
              initial={false}
              animate={bodyAnimate}
              transition={bodyTransition}
            />
          </g>
        </svg>
      </div>

      {hasDesc ? (
        <button
          ref={headerRef as React.RefObject<HTMLButtonElement>}
          type="button"
          data-sileo-header
          data-edge={expand}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={handleToggle}
        >
          {headerContent}
        </button>
      ) : (
        <div ref={headerRef as React.RefObject<HTMLDivElement>} data-sileo-header data-edge={expand}>
          {headerContent}
        </div>
      )}

      {hasDesc && (
        <div
          ref={cardRef}
          id={contentId}
          data-sileo-content
          data-edge={expand}
          data-visible={open}
          inert={!open || undefined}
        >
          <div ref={contentRef} data-sileo-description className={view.styles?.description}>
            {view.description}
            {actions.length > 0 && (
              <div data-sileo-actions>
                {actions.map((action, index) => (
                  <button
                    // the actions of one state keep their order; their titles may repeat
                    // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here
                    key={index}
                    type="button"
                    data-sileo-button
                    data-state={view.state}
                    className={view.styles?.button}
                    disabled={action.disabled}
                    aria-disabled={action.busy || undefined}
                    aria-busy={action.busy || undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      /* a running action keeps the focus (aria-disabled, not disabled) but does nothing again */
                      if (!action.busy) action.onClick();
                    }}
                  >
                    {action.title}
                  </button>
                ))}
              </div>
            )}
          </div>
          {dismissLabel && onDismiss ? (
            <button
              type="button"
              data-sileo-close
              aria-label={dismissLabel}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
});
