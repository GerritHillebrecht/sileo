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

  it("unmounting a Toaster ends only its own timers; the toasts stay, and StrictMode removes nothing", () => {
    const first = render(<Toaster />);
    show({ id: "stay", title: "Bleibt", duration: null });
    first.unmount();
    render(
      <StrictMode>
        <Toaster />
      </StrictMode>,
    );
    advance(100);
    expect(toastOf("stay")).not.toBeNull();
    expect(toastOf("stay")?.dataset.exiting).toBe("false");
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
    expect(buttons.map((b) => [b.textContent, b.disabled, b.getAttribute("aria-busy")])).toEqual([
      ["Annehmen", false, null],
      ["Ablehnen", true, null],
      ["Öffnen", true, "true"],
    ]);
    fireEvent.click(buttons[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(content.hasAttribute("inert")).toBe(true);
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
