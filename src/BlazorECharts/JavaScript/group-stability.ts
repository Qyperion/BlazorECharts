import type { ChartInstance } from './chart-instance.ts';
import type { GroupCoordinator } from './group-coordinator.ts';

/** A synchronous snapshot; no awaits are permitted between final recheck and native capture. */
export function captureMembers(chart: ChartInstance, groups: GroupCoordinator, connected: boolean) {
  const group = chart.native.group ?? '';
  const snapshot = groups.snapshot(group);
  const members = connected && snapshot.connected ? groups.members(group) : [chart];
  return {
    key: JSON.stringify([group, connected && snapshot.connected, members.map(c => c.events.chartId)]),
    connected: connected && snapshot.connected,
    members,
  };
}
