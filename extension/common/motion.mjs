/*
 * Presentation-only helpers. Nothing here reads or writes application state;
 * pages call these to bridge animations across the `hidden` attribute, which
 * cannot be transitioned.
 */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

/** True when the user asked the OS for reduced motion. */
export const prefersReducedMotion = () => REDUCED.matches;

/**
 * Collapse an element that uses the .collapsible wrapper pattern.
 *
 * The element stays in the DOM while it animates, then gets `hidden` so it is
 * removed from the accessibility tree, matching the original toggle semantics.
 * Returns a promise that settles once the element is hidden.
 */
export function collapse(element, { duration = 300 } = {}) {
  if (!element || element.hidden) return Promise.resolve();
  if (prefersReducedMotion()) {
    element.hidden = true;
    return Promise.resolve();
  }
  element.dataset.collapsed = 'true';
  return new Promise(resolve => {
    const done = () => {
      element.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
      element.hidden = true;
      resolve();
    };
    const onEnd = event => {
      if (event.target === element && event.propertyName === 'grid-template-rows') done();
    };
    const timer = setTimeout(done, duration + 60);
    element.addEventListener('transitionend', onEnd);
  });
}

/** Reverse of collapse; restores layout before the transition starts. */
export function expand(element, { duration = 300 } = {}) {
  if (!element || !element.hidden) return Promise.resolve();
  element.hidden = false;
  if (prefersReducedMotion()) {
    element.dataset.collapsed = 'false';
    return Promise.resolve();
  }
  // Force a reflow so the collapsed start state is committed before flipping.
  void element.offsetHeight;
  element.dataset.collapsed = 'false';
  return new Promise(resolve => setTimeout(resolve, duration));
}

/** Toggle helper that always leaves `root.hidden` consistent with `visible`. */
export async function setVisible(root, visible, options) {
  return visible ? expand(root, options) : collapse(root, options);
}

/**
 * Animate a popover out, then run `after` (typically hiding it).
 * Falls back to an immediate call when motion is reduced or the element is gone.
 */
export function animateOut(element, after) {
  if (!element || prefersReducedMotion()) {
    after();
    return;
  }
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    element.removeEventListener('animationend', once);
    element.classList.remove('is-leaving');
    after();
  };
  element.classList.add('is-leaving');
  element.addEventListener('animationend', once);
  setTimeout(once, 260);
}

/** Adds a one-shot colour transition class so a theme flip cross-fades. */
export function transitionTheme(root = document.documentElement, duration = 260) {
  if (prefersReducedMotion()) return;
  root.classList.add('theme-transition');
  setTimeout(() => root.classList.remove('theme-transition'), duration);
}
