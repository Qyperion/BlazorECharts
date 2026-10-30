// A hidden page gets no animation frames, so its charts cannot finish animating until the page is shown again.

let shownAt = -Infinity;

document.addEventListener('visibilitychange', () => {
  if (!document.hidden)
    shownAt = performance.now();
});

export function mark() {
  return performance.now();
}

export function hiddenSince(mark) {
  return document.hidden || shownAt > mark;
}

export function whenVisible() {
  return new Promise(resolve => {
    if (!document.hidden) {
      resolve();
      return;
    }

    document.addEventListener('visibilitychange', function shown() {
      if (document.hidden)
        return;

      document.removeEventListener('visibilitychange', shown);
      resolve();
    });
  });
}
