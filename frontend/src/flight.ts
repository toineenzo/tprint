/**
 * The little "it went over there" animation after a print or queue.
 *
 * A print used to change two lists silently: the receipt appeared in history,
 * or the job appeared in the queue, with nothing tying that to the button you
 * pressed. This flies a small ghost from the control you clicked to the panel
 * the item landed in.
 *
 * Deliberately a plain module rather than a React context: there is exactly one
 * of each destination on the page, the animation touches the DOM directly, and
 * `usePrint` is the only caller. A provider would be ceremony around a Map.
 */

/** Where an item can land. Matches the panels that own each list. */
export type FlightTarget = "history" | "queue";

const targets = new Map<FlightTarget, HTMLElement>();

/** Ref callback for a destination panel. Pass null on unmount. */
export function registerFlightTarget(
  name: FlightTarget,
  element: HTMLElement | null,
): void {
  if (element) targets.set(name, element);
  else targets.delete(name);
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The rect of the control the user last pressed.
 *
 * Captured on pointerdown rather than read from `document.activeElement` when
 * the flight starts. That was the obvious approach and it is wrong: a print is
 * async, `useSubmit` disables the button while it runs, and a disabled button
 * drops focus to <body> — so every flight launched from the centre of the page
 * instead of from the button, which is precisely the connection this is
 * supposed to draw.
 *
 * Costs no per-component wiring: any button anywhere becomes a valid origin
 * without knowing this module exists.
 */
let lastPress: { rect: DOMRect; at: number } | null = null;

/** Beyond this the press is stale and the origin would be misleading. */
const PRESS_TTL_MS = 15_000;

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest("button, [role='button'], a, input");
      const element = control ?? target;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        lastPress = { rect, at: Date.now() };
      }
    },
    // Capture, so a handler that stops propagation can't hide the press.
    true,
  );
}

function sourceRect(): DOMRect | null {
  if (!lastPress || Date.now() - lastPress.at > PRESS_TTL_MS) return null;
  return lastPress.rect;
}

/** A non-moving acknowledgement, for reduced-motion users. */
function pulse(target: HTMLElement): void {
  target.classList.remove("flight-pulse");
  // Force a reflow so re-adding the class restarts the animation when two
  // prints land in quick succession.
  void target.offsetWidth;
  target.classList.add("flight-pulse");
  window.setTimeout(() => target.classList.remove("flight-pulse"), 700);
}

/**
 * Fly a ghost from the clicked control to `name`'s panel.
 *
 * Silently does nothing when the destination isn't mounted (the queue card is
 * absent on the login page) or the browser has no Web Animations API — this is
 * decoration, and must never be able to break a print.
 */
export function flyToTarget(name: FlightTarget): void {
  if (typeof document === "undefined") return;
  const target = targets.get(name);
  if (!target) return;

  if (prefersReducedMotion()) {
    pulse(target);
    return;
  }

  const from = sourceRect();
  const to = target.getBoundingClientRect();
  if (!from || typeof document.body.animate !== "function") {
    pulse(target);
    return;
  }

  const ghost = document.createElement("div");
  ghost.className = "flight-ghost";
  ghost.style.left = `${from.left + from.width / 2}px`;
  ghost.style.top = `${from.top + from.height / 2}px`;
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  // Aim at the top of the panel rather than its middle: that's where a new
  // entry actually appears, and a tall panel's centre can be off-screen.
  const dy = to.top + Math.min(48, to.height / 2) - (from.top + from.height / 2);

  const animation = ghost.animate(
    [
      { transform: "translate(-50%, -50%) scale(1)", opacity: 0.9 },
      {
        transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.35}px)) scale(0.8)`,
        opacity: 0.85,
        offset: 0.55,
      },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.25)`,
        opacity: 0,
      },
    ],
    { duration: 520, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
  );

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    ghost.remove();
    pulse(target);
  };
  // Both the promise and a timeout: a ghost is decoration appended to <body>,
  // and must not be able to outlive its animation if the event never lands
  // (a backgrounded tab can leave one pending indefinitely).
  void animation.finished.then(cleanup).catch(cleanup);
  window.setTimeout(cleanup, 1200);
}
