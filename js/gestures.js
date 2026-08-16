/* Touch/pointer gestures layered on top of the click-based dispatch system.
   Two independent gestures, decided once per pointerdown by where it started:
   1. Row swipe (Records list) — live-following reveal of Edit/Delete, direct
      style manipulation only, never calls render() mid-drag.
   2. Tab swipe (Dashboard/Records/Transport/Split) — threshold release only
      (no live carousel-follow, since that would need pre-rendering neighbor
      tabs); on release it calls goToTab() which drives the CSS slide-in. */

const SWIPE_OPEN_X = -116;
const ROW_DRAG_THRESHOLD = 8;
const TAB_SWIPE_THRESHOLD = 70;

let openSwipeRow = null; // the currently-open .swipe-row element, if any

function closeSwipeRow(rowEl) {
  const content = rowEl.querySelector('.swipe-content');
  if (content) content.style.transform = 'translateX(0px)';
  if (openSwipeRow === rowEl) openSwipeRow = null;
}

// A single click can mean two different things depending on what just happened:
// the synthetic click a browser fires right after a drag-release (which must be
// swallowed outright, whichever way the row ended up), or a genuine tap outside
// an already-open row (which should close it instead of triggering what's under
// the tap). suppressNextClick always wins since it reflects the more recent event.
let suppressNextClick = false;

document.addEventListener('click', e => {
  if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); return; }
  if (!openSwipeRow) return;
  const withinActions = e.target.closest('.swipe-actions');
  if (withinActions && openSwipeRow.contains(withinActions)) return; // let Edit/Delete fire normally
  e.preventDefault();
  e.stopPropagation();
  closeSwipeRow(openSwipeRow);
}, true);

let gesture = null; // { type: 'row'|'tab', el, content, startX, startY, axis, baseX }

document.addEventListener('pointerdown', e => {
  if (gesture) return;
  if (!e.isPrimary) return;

  const rowEl = e.target.closest('.swipe-row');
  if (rowEl) {
    const content = rowEl.querySelector('.swipe-content');
    const baseX = openSwipeRow === rowEl ? SWIPE_OPEN_X : 0;
    gesture = { type: 'row', el: rowEl, content, startX: e.clientX, startY: e.clientY, axis: null, baseX };
    return;
  }

  const scrollEl = e.target.closest('#scroll-area');
  if (scrollEl && !e.target.closest('.sheet') && !e.target.closest('.h-scroll') && !UI.sheet && !UI.confirmDialog && !UI.quickAddMenu &&
      UI.screen !== 'trips' && TAB_ORDER.includes(UI.tab)) {
    gesture = { type: 'tab', startX: e.clientX, startY: e.clientY, axis: null };
  }
});

document.addEventListener('pointermove', e => {
  if (!gesture) return;
  const dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;

  if (!gesture.axis) {
    if (Math.abs(dx) < ROW_DRAG_THRESHOLD && Math.abs(dy) < ROW_DRAG_THRESHOLD) return;
    gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (gesture.axis === 'y') { gesture = null; return; } // let native vertical scroll take over
  }

  if (gesture.axis === 'x') {
    e.preventDefault();
    if (gesture.type === 'row') {
      const next = Math.max(SWIPE_OPEN_X, Math.min(0, gesture.baseX + dx));
      gesture.content.style.transform = `translateX(${next}px)`;
    }
    // tab gesture: intentionally no live visual follow, see file header.
  }
}, { passive: false });

document.addEventListener('pointerup', e => {
  if (!gesture) return;
  const dx = e.clientX - gesture.startX;

  if (gesture.axis === 'x') {
    if (gesture.type === 'row') {
      if (openSwipeRow && openSwipeRow !== gesture.el) closeSwipeRow(openSwipeRow);
      const opening = gesture.baseX + dx < SWIPE_OPEN_X / 2;
      gesture.content.style.transform = `translateX(${opening ? SWIPE_OPEN_X : 0}px)`;
      openSwipeRow = opening ? gesture.el : null;
      if (Math.abs(dx) >= ROW_DRAG_THRESHOLD) suppressNextClick = true;
    } else if (gesture.type === 'tab') {
      if (Math.abs(dx) >= TAB_SWIPE_THRESHOLD) {
        const idx = TAB_ORDER.indexOf(UI.tab);
        const nextIdx = dx < 0 ? idx + 1 : idx - 1;
        if (nextIdx >= 0 && nextIdx < TAB_ORDER.length) goToTab(TAB_ORDER[nextIdx]);
      }
    }
  }
  gesture = null;
});

document.addEventListener('pointercancel', () => { gesture = null; });
