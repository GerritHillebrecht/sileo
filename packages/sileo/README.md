<div align="center">
  <h1>sileo</h1>
  <p>An opinionated, physics-based toast component for React.</p>
  <p><a href="https://sileo.aaryan.design">Try Out</a> &nbsp; / &nbsp; <a href="https://sileo.aaryan.design/docs">Docs</a></p>
  <video src="https://github.com/user-attachments/assets/a292d310-9189-490a-9f9d-d0a1d09defce"></video>
</div>

### Installation

```bash
npm i sileo
```

### Getting Started

```tsx
import { sileo, Toaster } from "sileo";

export default function App() {
  return (
    <>
      <Toaster position="top-right" />
      <YourApp />
    </>
  );
}
```

For detailed docs, click here: https://sileo.aaryan.design

## OneServe fork

This fork (`GerritHillebrecht/sileo`, branch `feat/oneserve`) keeps Sileo's look and motion and adds what an operations
app needs. It is packed for OneServe as `@one-serve/sileo` (`bun run pack:oneserve`, see `NOTICE`); the workspace keeps
the name `sileo`, so the site and CI stay as upstream has them. Upstream `main` is untouched.

Additions and changes, with their reasons:

- **Ids and updates:** a public `id`; without one every toast gets its own (0.1.6 shared `"sileo-default"`, so toasts
  replaced each other). `show()` with a live id replaces in place (original swap animation); the new `sileo.update(id,
  patch)` changes a live toast quietly – no swap, no new entrance, the time runs on unless `duration` is given (then it
  starts anew; `null` keeps the toast). Unknown, dismissed or leaving ids are left alone (`false`).
- **Lifetimes:** exit removal, timers and promise results act on their own instance only (0.1.6: a toast set again
  during the 600 ms exit was removed by the old timer, upstream issue #30; a late promise result overwrote a newer
  toast). Pointer or focus inside pauses the time, which then goes on with what was left. `onDismiss(id, reason)` with
  `"user" | "timeout" | "programmatic" | "clear"`, once. Unmounting a `Toaster` ends its own timers only; `clear()` ends
  the toasts.
- **Controls:** the toast is a `group`, not a `button` with an anchor inside. The header is the disclosure
  (`aria-expanded`, `aria-controls`), `buttons` are real buttons (several; `disabled`, `busy`), an optional close button
  (`dismissLabel`). The collapsed card is `inert`. Keyboard and touch open it without hover; focus keeps it open; Escape
  closes it from inside only, never a key already handled (a dialog). A toast that leaves with the focus hands it to the
  next toast or back to where it came from, never out of an open modal. `stateLabel` is read after the title.
- **Announcements:** one polite and one assertive live region per `Toaster`, always present. `show()` announces the
  title (or `announce`, or nothing with `false`), `update()` only an `announce` it is given; `urgency: "assertive"` on
  request only. The viewport's own `aria-live` is gone, so nothing is read twice.
- **Motion:** `motion` is a peer dependency, `^14.7.1` (the version this fork is tested with). With reduced motion no
  spring, shape morph or gooey filter runs; the CSS transitions are cut as before.
- **Toasts that stay:** a toast with `duration: null` opens once by itself and closes back to its pill like a timed
  one (0.1.6 never opened it), so an error or a waiting decision is seen; `autopilot: false` turns it off.
- **Stack:** `visibleToasts` limits the toasts per position (the one in use stays shown), the rest behind a "more"
  button (`moreLabel`, `lessLabel`); `label` names the region. Safe-area padding at the screen edges.
- **Contrast:** with an explicit theme the original colours miss 4.5:1 (light toast: every text 2.0–3.9; dark toast:
  the buttons 4.0). Per theme only the colour values change (darker state colours and description on the light toast,
  lighter button text on the dark one); measured over the SVG fill.
- **Looks:** shapes, filter, type and timing are the original, colours apart from the contrast change above; added controls use the original button style.
  The focus ring uses `--sileo-focus-ring` (default: the action colour). Touch targets grow on coarse pointers.

Tests: `bun run test` (vitest, happy-dom). Motion, focus rings and the filter are checked in a real browser by OneServe.
