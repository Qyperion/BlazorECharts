// Reports the catalog cards that come near the viewport, each once, so that the catalog creates only the charts a
// reader can see. Cards added later, after a search, are observed too.

export function observeCards(list, catalog) {
  const shown = new Set();
  const visibility = new IntersectionObserver(entries => {
    const slugs = [];
    for (const entry of entries) {
      if (!entry.isIntersecting)
        continue;

      visibility.unobserve(entry.target);
      if (!shown.has(entry.target.dataset.slug)) {
        shown.add(entry.target.dataset.slug);
        slugs.push(entry.target.dataset.slug);
      }
    }

    // A catalog that is being left no longer takes the call.
    if (slugs.length > 0)
      catalog.invokeMethodAsync('ShowThumbnails', slugs).catch(() => {});
  }, { rootMargin: '200px 0px' });

  const observe = card => {
    if (card.nodeType === Node.ELEMENT_NODE && card.dataset.slug && !shown.has(card.dataset.slug))
      visibility.observe(card);
  };

  list.querySelectorAll('[data-slug]').forEach(observe);
  const additions = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(observe)));
  additions.observe(list, { childList: true });

  return {
    dispose() {
      visibility.disconnect();
      additions.disconnect();
    },
  };
}
