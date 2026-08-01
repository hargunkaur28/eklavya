// Put the viewport back at the top of the page.
//
// `window.scrollTo` alone is not enough here. `main` carries `overflow-x: hidden`,
// and a box with a hidden overflow on one axis computes the OTHER axis to `auto` —
// so `main` is itself a scroll container, and on a long dashboard the scrolled
// element is `main`, not the document. Resetting only the window looks like nothing
// happened. (This is the same CSS behaviour that broke the exam's sticky navbar.)
//
// Both are reset because which one actually holds the scroll depends on the route
// and the viewport, and getting it wrong is silent — you land halfway down a page
// with no indication why.
const CONTAINERS = ['main', '.dashboard-main', '.dashboard-card'];

export function scrollToTop() {
  if (typeof window === 'undefined') return;

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;

  for (const selector of CONTAINERS) {
    for (const el of document.querySelectorAll(selector)) {
      // Guarded rather than assigned unconditionally: writing scrollTop on an element
      // that is already at 0 is harmless, but writing it on one the user is actively
      // scrolling is not, and this runs on every section switch.
      if (el.scrollTop) el.scrollTop = 0;
    }
  }
}

export default scrollToTop;
