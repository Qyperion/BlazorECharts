// A deterministic reconnect fixture. The component itself does not choose circuit policy.
if (location.pathname.includes('/harness/lifecycle/')) {
  window.lifecycleConnection = { down: 0, up: 0 };
  Blazor.start({ circuit: { reconnectionHandler: {
    onConnectionDown() {
      window.lifecycleConnection.down++;
      document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'show' } }));
    },
    onConnectionUp() {
      window.lifecycleConnection.up++;
      document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'hide' } }));
    },
  } } });
} else {
  Blazor.start();
}
