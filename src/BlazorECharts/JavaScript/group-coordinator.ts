import type { ChartInstance } from './chart-instance.ts';

export interface GroupSnapshot {
  readonly version: number;
  readonly group: string;
  readonly connected: boolean;
  readonly members: readonly string[];
}

/** Page-owned membership, observable without a .NET polling loop. */
export class GroupCoordinator {
  #version = 0;
  readonly #charts = new Map<string, ChartInstance>();
  readonly #connected = new Set<string>();
  readonly #listeners = new Set<(snapshot: GroupSnapshot) => void>();

  get size(): number {
    return this.#charts.size;
  }

  track(id: string, chart: ChartInstance): void {
    this.#charts.set(id, chart);
    const native = chart.native;
    let group = native.group;
    Object.defineProperty(native, 'group', {
      configurable: true,
      enumerable: true,
      get: () => group,
      set: next => {
        const old = group;
        group = next;
        if (old === next || this.#charts.get(id)?.native !== native)
          return;

        this.changed(old ?? '');
        this.changed(next ?? '');
      },
    });
    this.changed(group ?? '');
  }

  remove(id: string): void {
    const group = this.#charts.get(id)?.native.group ?? '';
    this.#charts.delete(id);
    this.changed(group);
  }

  connect(group: string): void {
    this.#connected.add(group);
    this.changed(group);
  }

  disconnect(group: string): void {
    this.#connected.delete(group);
    this.changed(group);
  }

  changed(group: string): void {
    this.#version++;
    const snapshot = this.snapshot(group);
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch { /* Observers cannot interrupt membership updates. */ }
    }
  }

  snapshot(group: string): GroupSnapshot {
    return Object.freeze({
      version: this.#version,
      group,
      connected: this.#connected.has(group),
      members: Object.freeze([...this.#charts].filter(([, c]) => c.native.group === group && !c.native.isDisposed?.()).map(([id]) => id)),
    });
  }

  members(group: string): readonly ChartInstance[] {
    return this.snapshot(group).members.map(id => this.#charts.get(id)!);
  }

  subscribe(listener: (snapshot: GroupSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
}
