/**
 * Keyed DOM reconciler.
 *
 * Instead of wiping a container and rebuilding it every poll (which destroys
 * scroll position, hover state and replays animations — the "jank"), this
 * updates existing elements in place, creates only genuinely new ones, removes
 * stale ones, and reorders the survivors to match the desired order.
 *
 * @param {HTMLElement} parent
 * @param {Array<{key: string, create: () => HTMLElement, update?: (el: HTMLElement) => void}>} items
 */
function reconcileChildren(parent, items) {
  const existing = new Map();
  for (const el of Array.from(parent.children)) {
    if (el.__rkey != null) existing.set(el.__rkey, el);
  }

  const seen = new Set();
  items.forEach((item, index) => {
    seen.add(item.key);
    let el = existing.get(item.key);
    if (el) {
      if (item.update) item.update(el);
    } else {
      el = item.create();
      el.__rkey = item.key;
    }
    // Place el at position `index`. Comparing against the live children
    // collection is safe because everything before `index` is already final.
    const current = parent.children[index];
    if (current !== el) {
      parent.insertBefore(el, current || null);
    }
  });

  for (const [key, el] of existing) {
    if (!seen.has(key)) el.remove();
  }
}
