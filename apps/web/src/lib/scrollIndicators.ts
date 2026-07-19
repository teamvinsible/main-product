/** Show thin scroll indicators only while the user is actively scrolling. */

const SCROLLING_MS = 850;
const timers = new WeakMap<Element, number>();

function markScrolling(el: Element) {
  el.classList.add("is-scrolling");
  const prev = timers.get(el);
  if (prev) window.clearTimeout(prev);
  const id = window.setTimeout(() => {
    el.classList.remove("is-scrolling");
    timers.delete(el);
  }, SCROLLING_MS);
  timers.set(el, id);
}

function onScroll(event: Event) {
  const target = event.target;
  if (target instanceof Element) markScrolling(target);
  else if (target === document) markScrolling(document.documentElement);
}

document.addEventListener("scroll", onScroll, { capture: true, passive: true });
