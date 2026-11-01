import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sileo, Toaster } from "../src/index";

// happy-dom's Web Animations reject on cancel; without them Motion animates in JavaScript
const animate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
beforeAll(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
});
afterAll(() => {
  if (animate) Object.defineProperty(Element.prototype, "animate", animate);
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => sileo.clear());
  cleanup();
  vi.useRealTimers();
});

const toastOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-sileo-toast][data-id="${id}"]`);
const liveToasts = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-sileo-toast]:not([data-exiting="true"])'));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const show = (opts: Parameters<typeof sileo.show>[0]) => {
  let id = "";
  act(() => {
    id = sileo.show(opts);
  });
  return id;
};

describe("identity and updates", () => {
  it("gives every toast without an id its own, so independent toasts never replace each other", () => {
    render(<Toaster />);
    const a = show({ title: "Erste" });
    const b = show({ title: "Zweite" });
    expect(a).not.toBe(b);
    expect(liveToasts()).toHaveLength(2);
  });

  it("show() with the id of a live toast replaces it in place; other ids stay apart", () => {
    render(<Toaster />);
    show({ id: "image", title: "Bild wird hochgeladen", type: "loading" });
    show({ id: "publish", title: "Wird veröffentlicht", type: "loading" });
    const element = toastOf("image");
    show({ id: "image", title: "Bild fehlgeschlagen", type: "error" });
    expect(toastOf("image")).toBe(element);
    expect(toastOf("image")?.dataset.state).toBe("error");
    expect(liveToasts()).toHaveLength(2);
  });

  it("update() changes a live toast quietly and never revives an unknown, dismissed or leaving one", () => {
    render(<Toaster />);
    show({ id: "upload", title: "Upload", description: "10 %", type: "info", duration: null });
    let result = false;
    act(() => {
      result = sileo.update("upload", { description: "60 %" });
    });
    expect(result).toBe(true);
    expect(toastOf("upload")?.textContent).toContain("60 %");
    act(() => {
      result = sileo.update("nobody", { title: "Neu" });
    });
    expect(result).toBe(false);
    expect(toastOf("nobody")).toBeNull();
    act(() => {
      sileo.dismiss("upload");
      result = sileo.update("upload", { description: "90 %" });
    });
    expect(result).toBe(false);
    advance(1000);
    expect(toastOf("upload")).toBeNull();
  });

  it("an update while someone works with the toast keeps it open and the focus where it is", () => {
    render(<Toaster />);
    show({ id: "order", title: "Neue Bestellung", type: "action", description: "2× Rigatoni", buttons: [{ title: "Annehmen", onClick: () => {} }], duration: null });
    const header = toastOf("order")!.querySelector<HTMLElement>("[data-sileo-header]")!;
    act(() => header.focus());
    expect(toastOf("order")?.dataset.expanded).toBe("true");
    show({ id: "order", title: "Bestellung wird angenommen", type: "action", description: "2× Rigatoni", buttons: [{ title: "Annehmen", onClick: () => {} }], duration: null });
    act(() => {
      sileo.update("order", { description: "2× Rigatoni · 18:30" });
    });
    advance(1000);
    expect(toastOf("order")?.dataset.expanded).toBe("true");
    expect(document.activeElement).toBe(toastOf("order")!.querySelector("[data-sileo-header]"));
  });
});

describe("lifetime and races", () => {
  it("a dismissed toast set again with the same id during its exit stays (the old exit removes only its own instance)", () => {
    render(<Toaster />);
    show({ id: "a", title: "Erst" });
    act(() => {
      sileo.dismiss("a");
    });
    show({ id: "a", title: "Wieder da", duration: null });
    advance(2000);
    expect(liveToasts().map((t) => t.dataset.id)).toEqual(["a"]);
    expect(toastOf("a")?.textContent).toContain("Wieder da");
  });

  it("a late promise result never overwrites a toast set anew or brings back a cleared one", async () => {
    render(<Toaster />);
    let resolve: (value: string) => void = () => {};
    const pending = new Promise<string>((r) => {
      resolve = r;
    });
    act(() => {
      void sileo.promise(pending, { loading: { id: "pay", title: "Zahlung läuft" }, success: { title: "Bezahlt" }, error: { title: "Fehler" } });
    });
    show({ id: "pay", title: "Zahlung ungeklärt", type: "warning", duration: null });
    await act(async () => {
      resolve("ok");
      await pending;
    });
    expect(toastOf("pay")?.textContent).toContain("Zahlung ungeklärt");

    let resolveLater: (value: string) => void = () => {};
    const later = new Promise<string>((r) => {
      resolveLater = r;
    });
    act(() => {
      void sileo.promise(later, { loading: { id: "save", title: "Speichert" }, success: { title: "Gespeichert" }, error: { title: "Fehler" } });
    });
    act(() => sileo.clear());
    await act(async () => {
      resolveLater("ok");
      await later;
    });
    advance(1000);
    expect(toastOf("save")).toBeNull();
  });

  it("keeps a lifetime on a quiet update, starts a new one with a duration, and keeps a persistent toast", () => {
    render(<Toaster />);
    show({ id: "keep", title: "Läuft", duration: 4000 });
    advance(3000);
    act(() => {
      sileo.update("keep", { title: "Läuft noch" });
    });
    advance(1100);
    expect(toastOf("keep")?.dataset.exiting).toBe("true");

    show({ id: "restart", title: "Läuft", duration: 4000 });
    advance(3000);
    act(() => {
      sileo.update("restart", { title: "Erledigt", type: "success", duration: 4000 });
    });
    advance(3000);
    expect(toastOf("restart")?.dataset.exiting).toBe("false");
    advance(1100);
    expect(toastOf("restart")?.dataset.exiting).toBe("true");

    show({ id: "running", title: "Läuft", type: "loading", duration: null });
    advance(60_000);
    expect(toastOf("running")?.dataset.exiting).toBe("false");
    act(() => {
      sileo.update("running", { title: "Erledigt", type: "success", duration: 4000 });
    });
    advance(4100);
    expect(toastOf("running")?.dataset.exiting).toBe("true");

    show({ id: "unclear", title: "Prüft", duration: 4000 });
    act(() => {
      sileo.update("unclear", { title: "Ungeklärt", type: "warning", duration: null });
    });
    advance(60_000);
    expect(toastOf("unclear")?.dataset.exiting).toBe("false");
  });

  it("a toast that stays opens once by itself and closes back to its pill, like a timed one", () => {
    render(<Toaster />);
    show({ id: "stays", title: "Zahlung ungeklärt", type: "warning", description: "Status prüfen", duration: null });
    advance(300);
    expect(toastOf("stays")?.dataset.expanded).toBe("true");
    advance(5000);
    expect(toastOf("stays")?.dataset.expanded).toBe("false");
    expect(toastOf("stays")?.dataset.exiting).toBe("false");
  });

  it("pauses while the focus is inside and goes on with the remaining time", () => {
    render(<Toaster />);
    show({ id: "focus", title: "Gespeichert", description: "Pizza", duration: 4000 });
    advance(3000);
    const header = toastOf("focus")!.querySelector<HTMLElement>("[data-sileo-header]")!;
    act(() => header.focus());
    advance(10_000);
    expect(toastOf("focus")?.dataset.exiting).toBe("false");
    act(() => header.blur());
    advance(900);
    expect(toastOf("focus")?.dataset.exiting).toBe("false");
    advance(200);
    expect(toastOf("focus")?.dataset.exiting).toBe("true");
  });

  it("reports leaving once, with its reason; leaving changes nothing else", () => {
    render(<Toaster />);
    const onDismiss = vi.fn();
    show({ id: "u", title: "U", description: "x", dismissLabel: "Schließen", onDismiss, duration: null });
    fireEvent.click(screen.getByRole("button", { name: "Schließen", hidden: true }));
    act(() => {
      sileo.dismiss("u");
    });
    show({ id: "t", title: "T", onDismiss, duration: 1000 });
    advance(1100);
    show({ id: "p", title: "P", onDismiss, duration: null });
    act(() => {
      sileo.dismiss("p");
    });
    show({ id: "c", title: "C", onDismiss, duration: null });
    act(() => sileo.clear());
    expect(onDismiss.mock.calls).toEqual([
      ["u", "user"],
      ["t", "timeout"],
      ["p", "programmatic"],
      ["c", "clear"],
    ]);
  });

  it("unmounting a Toaster ends only its own timers; the toasts stay, keep their time after a StrictMode remount, and are not read again", () => {
    const first = render(<Toaster />);
    show({ id: "stay", title: "Bleibt", duration: null });
    show({ id: "timed", title: "Gespeichert", duration: 4000 });
    advance(1000);
    first.unmount();
    render(
      <StrictMode>
        <Toaster />
      </StrictMode>,
    );
    advance(100);
    expect(toastOf("stay")?.dataset.exiting).toBe("false");
    expect(toastOf("timed")?.dataset.exiting).toBe("false");
    // an old announcement is not read again by the new Toaster on its first update
    expect(document.querySelector('[data-sileo-announcer][aria-live="polite"]')?.textContent).toBe("");
    advance(4100);
    expect(toastOf("timed")?.dataset.exiting).toBe("true");
    expect(toastOf("stay")?.dataset.exiting).toBe("false");
    expect(document.querySelector('[data-sileo-announcer][aria-live="polite"]')?.textContent).toBe("");
  });

  it("an update during the swap of a show() is not lost", () => {
    render(<Toaster />);
    // the card opened by itself and nobody works with it: a show() swaps (close, then change after 200 ms)
    show({ id: "s", title: "Läuft", type: "info", description: "eins", duration: 6000 });
    advance(500);
    expect(toastOf("s")?.dataset.expanded).toBe("true");
    show({ id: "s", title: "Fehler", type: "error", description: "zwei", duration: 6000 });
    act(() => {
      sileo.update("s", { description: "drei" });
    });
    advance(1000);
    expect(toastOf("s")?.textContent).toContain("drei");
  });
});

describe("controls", () => {
  it("is no button with controls inside: a disclosure, separate actions (disabled, busy) and a close button", () => {
    render(<Toaster />);
    const onClick = vi.fn();
    show({
      id: "order",
      title: "Neue Bestellung",
      type: "action",
      stateLabel: "Handlung nötig",
      description: "2× Rigatoni",
      buttons: [
        { title: "Annehmen", onClick },
        { title: "Ablehnen", onClick: () => {}, disabled: true },
        { title: "Öffnen", onClick: () => {}, busy: true },
      ],
      dismissLabel: "Meldung schließen",
      duration: null,
    });
    const toast = toastOf("order")!;
    expect(toast.tagName).toBe("DIV");
    expect(toast.getAttribute("role")).toBe("group");
    for (const control of Array.from(toast.querySelectorAll("button, a"))) {
      expect(control.querySelector("button, a, input, [tabindex]")).toBeNull();
    }
    const header = toast.querySelector<HTMLElement>("[data-sileo-header]")!;
    expect(header.tagName).toBe("BUTTON");
    expect(header.textContent).toContain("Handlung nötig");
    const content = document.getElementById(header.getAttribute("aria-controls") ?? "")!;
    expect(content).not.toBeNull();
    // collapsed: the card is inert, its actions not reachable
    act(() => {
      header.blur();
    });
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(content.hasAttribute("inert")).toBe(false);
    const buttons = Array.from(content.querySelectorAll<HTMLButtonElement>("[data-sileo-button]"));
    // disabled: not operable; busy: keeps a focus (aria-disabled) and is marked running
    expect(buttons.map((b) => [b.textContent, b.disabled, b.getAttribute("aria-disabled"), b.getAttribute("aria-busy")])).toEqual([
      ["Annehmen", false, null, null],
      ["Ablehnen", true, null, null],
      ["Öffnen", false, "true", "true"],
    ]);
    fireEvent.click(buttons[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(content.hasAttribute("inert")).toBe(true);
  });

  it("keeps the focus when the action holding it starts running and goes away; the time is not left paused", () => {
    render(<Toaster />);
    let run = () => {};
    show({ id: "o", title: "Neue Bestellung", type: "action", description: "2× Rigatoni", duration: null, buttons: [{ title: "Annehmen", onClick: () => run() }] });
    fireEvent.click(toastOf("o")!.querySelector<HTMLElement>("[data-sileo-header]")!);
    const accept = screen.getByRole("button", { name: "Annehmen" });
    act(() => accept.focus());
    run = () => sileo.update("o", { buttons: [{ title: "Annehmen", busy: true, onClick: () => {} }] });
    fireEvent.click(accept);
    // running: still the focused button (aria-disabled, not disabled), a second click does nothing
    const busy = screen.getByRole("button", { name: "Annehmen" });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(busy);
    // the result replaces the toast without the button: the focus goes to the disclosure, not to the page
    show({ id: "o", title: "Angenommen", type: "success", description: "18:30", duration: 4000 });
    advance(600);
    expect(document.activeElement).toBe(toastOf("o")!.querySelector("[data-sileo-header]"));
    // and leaving the toast lets its time run out
    act(() => (document.activeElement as HTMLElement).blur());
    advance(4100);
    expect(toastOf("o")?.dataset.exiting).toBe("true");
  });

  it("clear() while a toast holds the focus gives it back and leaves no pause behind", () => {
    render(
      <>
        <button type="button">Ausgang</button>
        <Toaster />
      </>,
    );
    show({ id: "a", title: "A", description: "a", duration: null });
    const origin = screen.getByRole("button", { name: "Ausgang" });
    act(() => origin.focus());
    const header = toastOf("a")!.querySelector<HTMLElement>("[data-sileo-header]")!;
    fireEvent.focus(header, { relatedTarget: origin });
    act(() => header.focus());
    act(() => sileo.clear());
    expect(document.activeElement).toBe(origin);
    show({ id: "later", title: "Später", duration: 2000 });
    advance(2100);
    expect(toastOf("later")?.dataset.exiting).toBe("true");
  });

  it("a toast under the mouse stays open when a newer one arrives; a tap never pauses the time", () => {
    render(<Toaster />);
    show({ id: "h", title: "Fehler", type: "error", description: "Format", duration: null });
    const toast = toastOf("h")!;
    fireEvent.pointerOver(toast, { pointerType: "mouse" });
    expect(toast.dataset.expanded).toBe("true");
    show({ id: "n", title: "Neu", type: "info", description: "neu", duration: null });
    advance(1000);
    expect(toastOf("h")?.dataset.expanded).toBe("true");
    fireEvent.pointerOut(toast, { pointerType: "mouse" });

    show({ id: "t", title: "Gespeichert", duration: 2000 });
    fireEvent.pointerOver(toastOf("t")!, { pointerType: "touch" });
    advance(2100);
    expect(toastOf("t")?.dataset.exiting).toBe("true");
  });

  it("hands the focus back to its origin when the next toast has no disclosure", () => {
    render(
      <>
        <button type="button">Ausgang</button>
        <Toaster />
      </>,
    );
    show({ id: "plain", title: "Nur Titel", duration: null });
    show({ id: "rich", title: "Mit Text", description: "x", dismissLabel: "Schließen", duration: null });
    const origin = screen.getByRole("button", { name: "Ausgang" });
    const header = toastOf("rich")!.querySelector<HTMLElement>("[data-sileo-header]")!;
    fireEvent.click(header);
    const close = screen.getByRole("button", { name: "Schließen" });
    fireEvent.focus(close, { relatedTarget: origin });
    act(() => close.focus());
    fireEvent.click(close);
    expect(document.activeElement).toBe(origin);
  });

  it("Escape closes the card from inside only, and not a key someone else handled", () => {
    render(<Toaster />);
    show({ id: "e", title: "Fehler", type: "error", description: "Format", buttons: [{ title: "Erneut", onClick: () => {} }], duration: null });
    const header = toastOf("e")!.querySelector<HTMLElement>("[data-sileo-header]")!;
    fireEvent.click(header);
    const action = screen.getByRole("button", { name: "Erneut" });
    act(() => action.focus());
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => {
      action.dispatchEvent(handled);
    });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(action, { key: "Escape" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(header);
  });

  it("Escape from the close button also hands the focus to the disclosure, never into the inert card", () => {
    render(<Toaster />);
    show({ id: "c", title: "Hinweis", type: "info", description: "Text", dismissLabel: "Schließen", duration: null });
    const header = toastOf("c")!.querySelector<HTMLElement>("[data-sileo-header]")!;
    fireEvent.click(header);
    const close = screen.getByRole("button", { name: "Schließen" });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: "Escape" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(header);
  });

  it("shows at most visibleToasts and keeps the rest reachable", () => {
    render(<Toaster visibleToasts={3} moreLabel={(n) => `${n} weitere`} lessLabel="Weniger" />);
    for (const id of ["a", "b", "c", "d", "e"]) show({ id, title: id, duration: null });
    expect(liveToasts()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "2 weitere" }));
    expect(liveToasts()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Weniger" }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("announcements", () => {
  it("announces show() and an update only when it says so, with the asked urgency; one live region of each kind", () => {
    render(<Toaster />);
    const polite = () => document.querySelector('[data-sileo-announcer][aria-live="polite"]')!.textContent;
    const assertive = () => document.querySelector('[data-sileo-announcer][aria-live="assertive"]')!.textContent;
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(2);
    show({ id: "img", title: "Bild wird hochgeladen", type: "loading", duration: null });
    expect(polite()).toContain("Bild wird hochgeladen");
    act(() => {
      sileo.update("img", { description: "40 %" });
    });
    expect(polite()).toContain("Bild wird hochgeladen");
    act(() => {
      sileo.update("img", { title: "Bild fehlgeschlagen", type: "error", announce: "Bild fehlgeschlagen" });
    });
    expect(polite()).toContain("Bild fehlgeschlagen");
    expect(assertive()).toBe("");
    show({ id: "order", title: "Neue Bestellung", urgency: "assertive", duration: null });
    expect(assertive()).toContain("Neue Bestellung");
    show({ id: "quiet", title: "Still", announce: false, duration: null });
    expect(polite()).not.toContain("Still");
  });
});
