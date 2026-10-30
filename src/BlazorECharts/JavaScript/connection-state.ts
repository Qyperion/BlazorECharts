/** The Interactive Server connection as the browser sees it: Blazor's reconnect UI event and the fallback reconnect dialog. */
class ConnectionState {
  #connected = true;
  readonly #listeners = new Set<() => void>();
  readonly #disconnections = new Set<() => void>();

  constructor(readonly document: Document) {
    document.addEventListener(
      'components-reconnect-state-changed',
      event => {
        const state = (event as CustomEvent<{ state: string }>).detail?.state;
        if (!state)
          return;

        const connected = state === 'hide';
        const changed = connected !== this.#connected;
        this.#connected = connected;
        if (connected)
          for (const listener of [...this.#listeners])
            listener();
        else if (changed)
          for (const listener of [...this.#disconnections])
            listener();
      },
      true
    );
  }

  get connected(): boolean {
    return this.#connected && !this.#fallbackDisconnected();
  }

  /** Runs `listener` when the circuit reconnects; returns the unsubscribe function. */
  onReconnected(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Runs `listener` when a reconnect UI reports the outage; Blazor's fallback overlay raises no event. */
  onDisconnected(listener: () => void): () => void {
    this.#disconnections.add(listener);
    return () => this.#disconnections.delete(listener);
  }

  #fallbackDisconnected(): boolean {
    // .NET 10's fallback dialog is an open shadow root on a direct body child (including a custom dialogId).
    return Array.from(this.document.body?.children ?? []).some(element =>
      element.shadowRoot?.querySelector('.components-reconnect-overlay.components-reconnect-visible'));
  }
}

const states = new WeakMap<Document, ConnectionState>();
const detached = { connected: true, onReconnected: () => () => {}, onDisconnected: () => () => {} };

/** One shared connection state per document, used by chart observers and event delivery. */
export function connectionState(
  document: Document | undefined = globalThis.document
): Pick<ConnectionState, 'connected' | 'onReconnected' | 'onDisconnected'> {
  if (!document)
    return detached;

  let state = states.get(document);
  if (!state)
    states.set(document, state = new ConnectionState(document));

  return state;
}

/** The UTF-8 size of a string, the unit of the SignalR message limit. */
export function utf8Length(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x800)
      bytes += code >= 0xd800 && code < 0xdc00 ? 1 : 2;
    else if (code >= 0x80)
      bytes++;
  }

  return bytes;
}

// SignalR's rejections for a send or an invocation on a closed connection; a .NET exception mentions only the circuit options.
const closedConnection = /not in the 'Connected' State|connection (?:being )?closed|connection (?:was )?disconnected|JSDisconnected/i;

/** A rejected .NET callback is a lost circuit when the connection says so or SignalR reports a closed connection. */
export function isDisconnection(server: boolean, error: unknown): boolean {
  return (server && !connectionState().connected) || closedConnection.test(String(error));
}
