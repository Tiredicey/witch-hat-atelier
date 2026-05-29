// touch-gestures.js
//
// Two touch primitives for mobile UX:
//
//   attachSwipe(el, { onLeft, onRight, threshold, follow })
//     Listens for horizontal swipes on a single element. Calls onLeft or
//     onRight when the gesture commits past `threshold` (px). When `follow`
//     is true, translates the element by the live dx during the swipe and
//     snaps back if the gesture doesn't commit.
//
//   attachLongPress(el, ms, onLongPress)
//     Fires onLongPress after the user holds for `ms` milliseconds without
//     moving more than 10px. Cancels on touchend, touchcancel, or movement
//     past the slop threshold. Returns a teardown function.
//
// Both honour prefers-reduced-motion by skipping the follow translate.
// Both no-op on environments without TouchEvent.

const TAP_SLOP = 10;
const SWIPE_LOCK_RATIO = 1.5;  // dx must be 1.5x dy to engage horizontal swipe

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function attachSwipe(el, opts = {}) {
  if (!el || typeof window === "undefined") return () => {};
  const threshold = typeof opts.threshold === "number" ? opts.threshold : 80;
  const follow = opts.follow !== false;
  const onLeft = typeof opts.onLeft === "function" ? opts.onLeft : null;
  const onRight = typeof opts.onRight === "function" ? opts.onRight : null;

  let active = null;

  const start = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    active = {
      startX: t.clientX,
      startY: t.clientY,
      moved:  false,
      locked: false,
      el:     e.currentTarget,
    };
  };

  const move = (e) => {
    if (!active) return;
    const t = e.touches[0];
    const dx = t.clientX - active.startX;
    const dy = t.clientY - active.startY;
    if (!active.locked) {
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) {
        if (Math.abs(dx) > Math.abs(dy) * SWIPE_LOCK_RATIO) {
          active.locked = "x";
        } else {
          active.locked = "y";
        }
      }
    }
    if (active.locked === "x") {
      active.moved = true;
      if (follow && !reducedMotion()) {
        active.el.style.transform = `translateX(${dx}px)`;
        active.el.dataset.swipeDir = dx > 0 ? "right" : "left";
      }
      e.preventDefault();
    }
  };

  const end = (e) => {
    if (!active) return;
    const last = active;
    active = null;
    if (last.locked !== "x" || !last.moved) {
      last.el.style.transform = "";
      delete last.el.dataset.swipeDir;
      return;
    }
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) { last.el.style.transform = ""; delete last.el.dataset.swipeDir; return; }
    const dx = t.clientX - last.startX;
    last.el.style.transform = "";
    delete last.el.dataset.swipeDir;
    if (dx >= threshold && onRight) onRight(last.el);
    else if (dx <= -threshold && onLeft) onLeft(last.el);
  };

  const cancel = () => {
    if (!active) return;
    const last = active;
    active = null;
    last.el.style.transform = "";
    delete last.el.dataset.swipeDir;
  };

  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("touchmove", move,  { passive: false });
  el.addEventListener("touchend", end);
  el.addEventListener("touchcancel", cancel);

  return () => {
    el.removeEventListener("touchstart", start);
    el.removeEventListener("touchmove", move);
    el.removeEventListener("touchend", end);
    el.removeEventListener("touchcancel", cancel);
  };
}

export function attachLongPress(el, ms, onLongPress) {
  if (!el || typeof onLongPress !== "function") return () => {};
  const duration = typeof ms === "number" && ms > 0 ? ms : 500;
  let timer = null;
  let startX = 0;
  let startY = 0;

  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const start = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    clear();
    timer = setTimeout(() => {
      timer = null;
      onLongPress(e.currentTarget, e);
    }, duration);
  };

  const move = (e) => {
    if (!timer) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - startX) > TAP_SLOP ||
        Math.abs(t.clientY - startY) > TAP_SLOP) {
      clear();
    }
  };

  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("touchmove",  move,  { passive: true });
  el.addEventListener("touchend",   clear);
  el.addEventListener("touchcancel", clear);

  return () => {
    clear();
    el.removeEventListener("touchstart", start);
    el.removeEventListener("touchmove", move);
    el.removeEventListener("touchend", clear);
    el.removeEventListener("touchcancel", clear);
  };
}
