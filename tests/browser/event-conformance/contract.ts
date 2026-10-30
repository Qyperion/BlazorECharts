import { readFileSync } from 'node:fs';

type Payloads = Record<string, { json: unknown }[]>;

interface Contract {
  name: string;
  members: Map<string, string>;
}

/** The generated public contracts: an event class or option model with each member's JSON name and C# type. */
function contracts() {
  const events = new Map<string, Contract>();
  const models = new Map<string, Contract>();
  let current: Contract | undefined;
  for (const line of readFileSync('schemas/generated/public-api.txt', 'utf8').split('\n')) {
    const event = /^(\w+) : ChartEventPayload \[(\w+)\]$/.exec(line);
    const model = /^(\w+) : OptionObject$/.exec(line);
    if (event)
      events.set(event[2], current = { name: event[1], members: new Map() });
    else if (model)
      models.set(model[1], current = { name: model[1], members: new Map() });
    else if (!line.startsWith('  '))
      current = undefined;
    else if (current) {
      const member = /^ {2}(.+?) (\w+) \{ get;(?: set;)? \}(?: \[(\w+)(?::.*)?\])?$/.exec(line);
      if (member)
        current.members.set(member[3] ?? member[2][0].toLowerCase() + member[2].slice(1), member[1]);
    }
  }

  return { events, models };
}

export const typedEvents = () => Object.fromEntries(contracts().events);

const element = 'emitted for other series or components: percent (pie), treePathInfo (treemap, sunburst), treeAncestors (tree), dataType (graph, sankey), info (graphic), coord and targetType (matrix), break and selfType (axis breaks)';

const echo = (fields: string[], reason = 'echoes the dispatched action payload; absent when the caller does not set it') =>
  Object.fromEntries(fields.map(f => [f, reason]));

const pointer = {
  ...Object.fromEntries(
    ['break', 'coord', 'dataType', 'info', 'percent', 'selfType', 'targetType', 'treeAncestors', 'treePathInfo'].map(f => [f, element])
  ),
  $vars: 'formatter variable names of the data params; internal to ECharts',
  event: 'the native zrender event, a borrowed reference in NativeReferences',
};

const connect = { escapeConnect: 'connect bookkeeping of a dispatched action; internal to ECharts' };
const animation = { animation: 'transition settings that roam controllers pass along; internal to ECharts' };

/** Each difference between a typed contract and the ECharts 6.1.0 payload of these scenarios, with its reason. Anything else fails. */
export const allowed: Record<string, Record<string, string>> = {
  click: pointer,
  dblclick: pointer,
  mousedown: pointer,
  mouseup: pointer,
  mousemove: pointer,
  mouseover: pointer,
  mouseout: pointer,
  contextmenu: pointer,
  globalout: {
    ...Object.fromEntries([
      'color', 'componentIndex', 'componentSubType', 'componentType', 'data', 'dataIndex', 'dimensionNames', 'encode', 'name', 'seriesId',
      'seriesIndex', 'seriesName', 'seriesType', 'value', 'break', 'coord', 'dataType', 'info', 'percent', 'selfType', 'targetType', 'treeAncestors',
      'treePathInfo',
    ].map(f => [f, 'ECharts 6.1.0 emits globalout with its type and the native event only; documented on GlobalOutEvent'])),
    event: pointer.event,
  },
  highlight: { ...echo(['geoId', 'geoIndex', 'geoName', 'name', 'notBlur', 'seriesId', 'seriesName', 'dataIndex', 'seriesIndex']), ...connect },
  downplay: { ...echo(['geoId', 'geoIndex', 'geoName', 'name', 'notBlur', 'seriesId', 'seriesName', 'dataIndex', 'seriesIndex']), ...connect },
  selectchanged: connect,
  datazoom: echo(['dataZoomId', 'dataZoomIndex', 'start', 'end', 'startValue', 'endValue']),
  brush: echo(['brushId']),
  brushend: echo(['brushId']),
  axisareaselected: echo(['parallelAxisIndex']),
  axisbreakchanged: connect,
  globalcursortaken: echo(['dataZoomSelectActive', 'brushOption']),
  georoam: {
    ...echo(['seriesId', 'componentType', 'zoom', 'originX', 'originY', 'dx', 'dy']),
    totalZoom: 'documented, but not emitted by ECharts 6.1.0; documented on GeoRoamEvent',
    ...animation,
    geoId: 'echo of the dispatching geo selector',
  },
  graphroam: { ...echo(['componentType', 'zoom', 'originX', 'originY', 'dx', 'dy']), ...animation },
  treeroam: { ...echo(['componentType', 'zoom', 'originX', 'originY', 'dx', 'dy']), ...animation },
  timelinechanged: echo(['currentIndex']),
  showtip: {
    ...echo([
      'dataByCoordSys', 'dispatchAction', 'name', 'position', 'tooltip', 'tooltipOption', 'x', 'y', 'seriesIndex', 'dataIndex', 'dataIndexInside',
    ]),
    ...connect,
  },
  hidetip: { ...echo(['dispatchAction', 'escapeConnect']) },
  dragnode: echo(['animation', 'escapeConnect', 'seriesIndex', 'seriesName']),
  focusnodeadjacency: {
    ...echo(['animation', 'escapeConnect', 'excludeSeriesId', 'seriesIndex', 'seriesName']),
    dataIndex: 'read by the legacy graph handler, absent from the upstream payload type',
  },
  unfocusnodeadjacency: echo(['animation', 'escapeConnect', 'excludeSeriesId', 'seriesIndex', 'seriesName']),
  changeaxisorder: echo([
    'animation', 'escapeConnect', 'isInitSort', 'seriesId', 'seriesIndex', 'seriesName', 'xAxisId', 'xAxisIndex', 'xAxisName', 'yAxisId',
    'yAxisIndex', 'yAxisName',
  ]),
  parallelaxisexpand: echo([
    'animation', 'axisExpandCenter', 'axisExpandCount', 'axisExpandWidth', 'axisExpandable', 'escapeConnect', 'parallelIndex', 'parallelName',
  ]),
  updateaxispointer: echo(['escapeConnect']),
  brushselected: { 'batch.type': 'ECharts copies the event type into every brush selection' },
  sunbursthighlight: echo([
    'animation', 'dataIndex', 'dataIndexInside', 'dataType', 'escapeConnect', 'excludeSeriesId', 'highlightKey', 'name', 'notBlur', 'seriesIndex',
    'seriesName', 'targetNode',
  ]),
  sunburstunhighlight: echo([
    'animation', 'dataIndex', 'dataIndexInside', 'dataType', 'escapeConnect', 'excludeSeriesId', 'highlightKey', 'name', 'notBlur', 'seriesIndex',
    'seriesName',
  ]),
  sunburstroottonode: echo(['animation', 'escapeConnect', 'from', 'seriesIndex', 'seriesName', 'targetNode']),
  treeexpandandcollapse: echo(['animation', 'escapeConnect', 'seriesIndex', 'seriesName']),
  treemaproottonode: echo(['animation', 'escapeConnect', 'from', 'seriesIndex', 'seriesName', 'targetNode']),
};

// ECharts leaves its makeInner store (__ec_inner_N) on payload copies of a dispatched batch; it is not a contract field.
const internal = (key: string) => /^__ec_inner_\d+$/.test(key);

const keys = (values: unknown[]) =>
  new Set(values.flatMap(v => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).filter(k => !internal(k)) : []));

// The JSON kind a member of a primitive or primitive-array C# type reads; other members are typed models or unions.
const primitives: Record<string, string> = { 'int?': 'number', 'double?': 'number', 'bool?': 'boolean', 'string?': 'string' };
const shape = (type: string) => primitives[type] ?? (/^(int|double|bool|string)\[\]\?$/.test(type) ? 'array' : undefined);
const kind = (value: unknown) => Array.isArray(value) ? 'array' : typeof value;

export function conformance(payloads: Payloads) {
  const { events: typed, models } = contracts();
  const failures: string[] = [];
  const report: Record<string, unknown> = {};
  for (const [name, contract] of typed) {
    const jsons = (payloads[name] ?? []).map(p => p.json as Record<string, unknown>);
    const allow = allowed[name] ?? {};
    const emitted = keys(jsons);
    const members = new Set(contract.members.keys());
    for (const f of [...members].filter(f => !emitted.has(f) && !(f in allow)).sort())
      failures.push(`${name}: ${contract.name}.${f} is typed but not emitted`);

    for (const f of [...emitted].filter(f => !members.has(f) && !(f in allow)).sort())
      failures.push(`${name}: ${f} is emitted but not typed by ${contract.name}`);

    const batchType = contract.members.get('batch')?.replace(/\[\]\??$/, '');
    const items = jsons.flatMap(j => Array.isArray(j.batch) ? j.batch : []);
    if (items.length && !batchType)
      failures.push(`${name}: a batch is emitted but not typed by ${contract.name}`);

    if (batchType && items.length) {
      const item = batchType === contract.name ? contract : models.get(batchType);

      // ECharts writes batch: null into every item of a dispatched batch.
      const itemMembers = new Set([...(item?.members.keys() ?? []), 'batch']);
      const itemKeys = keys(items);
      if (!item)
        failures.push(`${name}: batch item type ${batchType} is unknown`);

      for (const f of [...itemKeys].filter(f => !itemMembers.has(f) && !(`batch.${f}` in allow) && !(f in allow)).sort())
        failures.push(`${name}: batch item field ${f} is emitted but not typed by ${batchType}`);
    }

    for (const [field, type] of contract.members) {
      const expected = shape(type);
      if (!expected)
        continue;

      for (const value of jsons.flatMap(j => [j, ...(Array.isArray(j.batch) ? j.batch : [])]).map(j => (j as Record<string, unknown>)?.[field]))
        if (value != null && kind(value) !== expected) {
          failures.push(`${name}: ${contract.name}.${field} is ${type} but ECharts emits ${JSON.stringify(value)}`);
          break;
        }
    }

    report[name] = {
      class: contract.name,
      payloads: jsons.length,
      emitted: [...emitted].sort(),
      typed: [...members].sort(),
      batch: items.length ? { type: batchType ?? null, emitted: [...keys(items)].sort() } : undefined,
    };
  }

  return { failures, events: report };
}
