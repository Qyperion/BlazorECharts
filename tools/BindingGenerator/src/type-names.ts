import { createHash } from 'node:crypto';
import type { TypeNode } from './schema.ts';
import { identifier } from './generation-model.ts';

/** Where a type is reached: the owning model or root, the C# property and the role suffixes (Item, Alternative, Entry, Signature). */
export interface NameHint {
  owner: string;
  property: string;
  suffix: string; /** For a union alternative: where the union itself is reached. */
  union?: NameHint;
}

export const hintText = (hint: NameHint) => hint.owner + hint.property + hint.suffix;

/**
 * Route of a type in the type name lock: `Owner.PropertySuffix`, or `Union|alternative` with its upstream name, discriminator
 * or structural fingerprint. Never a position: the order of alternatives follows content-hash ids and changes between releases.
 */
export function routeKey(hint: NameHint, type: TypeNode | undefined, types: Map<string, TypeNode>): string {
  if (!hint.union)
    return `${hint.owner}.${hint.property}${hint.suffix}`;

  if (!type)
    throw new Error(`TYPE_NAME_LOCK an alternative of ${hint.owner} has no type`);

  return `${hint.owner}|${tsName(type.display) ?? discriminator(types, type) ?? fingerprint(type)}`;
}

/** The declaration text of an alternative without bundle suffixes ($1); a long one keeps a readable prefix and a hash of the whole. */
function fingerprint(type: TypeNode): string {
  const text = type.display.replace(/\$\d+\b/g, '').replace(/\s+/g, ' ').trim();
  return text.length <= 120 ? text : `${text.slice(0, 96)}…${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
}

export interface NamingInput {
  /** Named types in discovery order: an owner precedes the types reached through its properties. */
  order: string[];

  /** Unique provisional names of the first projection; owners in `contexts` use them. */
  provisional: Map<string, string>;

  /** Override and root names; they never change. */
  fixed: Map<string, string>;

  contexts: Map<string, NameHint[]>;
  types: Map<string, TypeNode>;

  /** Upstream nodes before component specialization; generic references keep their targets here. */
  sourceTypes?: Map<string, TypeNode>;

  /** Shape kind of each named type: model, union, tuple or function. */
  kinds: Map<string, string>;

  /** Upstream type alias that declares exactly this type, read from its pinned source span. */
  alias?: (type: TypeNode) => string | undefined;

  /** Names a derived candidate must not take: BCL types, members of generated values, hand-written library types. */
  reserved?: Set<string>;

  /** Published names by route (see routeKey): a type reached through a locked route keeps that name. */
  locked?: Map<string, string>;

  /** Declarations that one named type represents (unions with the same alternatives); their upstream names are candidates too. */
  twins?: Map<string, string[]>;
}

/** BCL types brought in by implicit usings and member names of generated value structs. */
export const reservedTypeNames = new Set([
  'Action', 'Func', 'Predicate', 'Comparison', 'Converter', 'EventHandler', 'Delegate', 'Type', 'Object', 'String', 'Boolean', 'Byte', 'Char',
  'Double', 'Single', 'Int16', 'Int32', 'Int64', 'Decimal', 'Math', 'Array', 'Enum', 'Attribute', 'Exception', 'Task', 'ValueTask', 'Tuple',
  'ValueTuple', 'Lazy', 'Nullable', 'Index', 'Range', 'Version', 'Uri', 'Guid', 'TimeSpan', 'DateTime', 'DateTimeOffset', 'TimeZoneInfo', 'Buffer',
  'Convert', 'Random', 'Environment', 'Console', 'Activator', 'GC', 'Span', 'Memory', 'ReadOnlySpan', 'List', 'Dictionary', 'HashSet', 'Queue',
  'Stack', 'Enumerable', 'Queryable', 'Timer', 'Thread', 'JsonElement', 'JsonDocument', 'JsonSerializer', 'JsonValueKind', 'Utf8JsonWriter', 'Value',
  'From', 'Read', 'Matches', 'TryGet', 'Create', 'Write', 'Item',
]);

const tsName = (display: string) => /^[A-Za-z][A-Za-z0-9_$]*$/.test(display) ? identifier(display.replace(/\$\d+$/, '')) : undefined;
const pascal = (value: string) => identifier(value.replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/ (\w)/g, (_, c: string) => c.toUpperCase()));

function discriminator(types: Map<string, TypeNode>, type: TypeNode | undefined, seen = new Set<string>()): string | undefined {
  if (!type || seen.has(type.id))
    return undefined;

  seen.add(type.id);
  const value = types.get(type.properties?.find(p => p.name === 'type')?.type ?? '');
  if (value?.kind === 'literal' && typeof value.value === 'string')
    return value.value;

  for (const id of type.constituents ?? []) {
    const found = discriminator(types, types.get(id), seen);
    if (found)
      return found;
  }

  return undefined;
}

/** Upstream name: a declaring alias, or a generic target with its string-literal arguments, also for intersections of one target. */
export function upstreamName(types: Map<string, TypeNode>, type: TypeNode | undefined, alias?: NamingInput['alias']): string | undefined {
  if (!type)
    return undefined;

  const generic = (t: TypeNode | undefined) => {
    const target = t?.kind === 'generic-reference' ? types.get(t.target!) : undefined;
    const base = target && tsName(target.display.replace(/<[\s\S]*$/, ''));
    if (!base)
      return undefined;

    const literals = (t!.typeArguments ?? [])
      .map(id => types.get(id))
      .filter(a => a?.kind === 'literal' && typeof a.value === 'string')
      .map(a => pascal(String(a!.value)));
    return { base, literals };
  };
  if (type.kind === 'generic-reference') {
    const g = generic(type);
    if (g)
      return g.literals.join('') + g.base;
  }

  if (type.kind === 'intersection' && type.constituents?.length) {
    const parts = type.constituents.map(id => generic(types.get(id)));
    if (parts.every(p => p && p.base === parts[0]!.base)) {
      // Constituents are sorted by identity; the declared order distinguishes A & B from B & A.
      const declared = [...type.display.matchAll(/([A-Za-z_$][\w$]*)<"([^"]*)">/g)];
      const literals = declared.length === parts.length && declared.every(m => m[1] === parts[0]!.base)
        ? declared.map(m => pascal(m[2]))
        : parts.flatMap(p => p!.literals);
      return literals.join('') + parts[0]!.base;
    }

    // Named declarations intersected with `{ mainType?: ... }` markers: name after the declarations,
    // compressing their shared leading and trailing words (AxisLabelValueFormatter & AxisLabelTimeFormatter → AxisLabelValueTimeFormatter).
    const declaredParts = type.display.split(' & ').map(part => part.trim());
    const named = declaredParts.map(tsName);
    if (named.some(Boolean) && declaredParts.every((part, i) => named[i] || /^\{ mainType\?: "[^"]*"; \}$/.test(part))) {
      const words = named.filter((n): n is string => !!n).map(n => n.match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[0-9]+/g) ?? [n]);
      if (words.length === 1)
        return words[0].join('');

      let prefix = 0;
      while (words.every(w => prefix < w.length - 1 && w[prefix] === words[0][prefix]))
        prefix++;

      let suffix = 0;
      while (words.every(w => suffix < w.length - prefix - 1 && w[w.length - 1 - suffix] === words[0][words[0].length - 1 - suffix]))
        suffix++;

      return [
        ...words[0].slice(0, prefix),
        ...words.flatMap(w => w.slice(prefix, w.length - suffix)),
        ...words[0].slice(words[0].length - suffix),
      ].join('');
    }
  }

  return alias?.(type);
}

interface Candidate {
  name: string;
  strength: number;
}

const STRENGTH = { fixed: 5, ts: 4, discriminator: 3, upstream: 2, property: 1.5, qualified: 1.4, context: 1, fallback: 0 };
const words = (name: string): string[] => name.match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[0-9]+/g) ?? [];

function commonPrefix(lists: string[][]): string[] {
  let n = 0;
  while (lists.every(l => n < l.length && l[n] === lists[0][n]))
    n++;

  return lists[0].slice(0, n);
}

/**
 * Chooses stable C# type names without content hashes. Priority: overrides and roots, the type name lock, the upstream
 * identifier, the discriminator of a union alternative, the upstream name of a shared type, then the
 * context it is reached from. Equal claims on one name fall back together to their next candidate;
 * a collision that no candidate resolves needs an explicit `csharp.names` entry.
 */
export function chooseTypeNames(input: NamingInput): Map<string, string> {
  const byProvisional = new Map([...input.provisional].map(([id, name]) => [name, id]));

  // C# is case-sensitive, but the file names of generated types are not on Windows and macOS.
  const reserved = new Set([...input.reserved ?? []].map(name => name.toLowerCase()));
  let final = new Map<string, string>();
  let unresolved: string[] = [];
  let conflicts = new Map<string, string[]>();
  let moving: string[] = [];

  // Each round renames one more level of owners in the contexts; stop when nothing changes.
  for (let round = 0; round < 32; round++) {
    const owner = (name: string) => final.get(byProvisional.get(name) ?? '') ?? name;
    const candidates = new Map<string, Candidate[]>();
    conflicts = new Map();
    for (const id of input.order) {
      const list: Candidate[] = [];
      const fixed = input.fixed.get(id);
      const type = input.types.get(id);
      const contexts = [
        ...new Map((input.contexts.get(id) ?? [])
          .map(h => ({ ...h, owner: owner(h.owner), ...(h.union ? { union: { ...h.union, owner: owner(h.union.owner) } } : {}) }))
          .map(h => [hintText(h), h])).values(),
      ];
      const locked = fixed
        ? []
        : [...new Set(contexts.map(h => input.locked?.get(routeKey(h, type, input.types))).filter((name): name is string => !!name))];
      if (locked.length > 1)
        conflicts.set(id, locked);

      if (fixed)
        list.push({ name: fixed, strength: STRENGTH.fixed });
      else if (locked.length)
        list.push({ name: locked[0], strength: STRENGTH.fixed });
      else {
        const declarations = [id, ...input.twins?.get(id) ?? []];
        const ts = declarations.map(d => input.types.get(d)).find(t => t && tsName(t.display));
        if (ts)
          list.push({ name: tsName(ts.display)!, strength: STRENGTH.ts });

        const signature = input.kinds.get(id) === 'function' ? 'Signature' : '';
        const value = discriminator(input.types, type);

        // A discriminated alternative is named after the property that holds its union (XAxisCategoryOption).
        const alternative = contexts.find(h => h.union)?.union;
        if (value && alternative && type && ['object', 'intersection'].includes(type.kind)) {
          const core = alternative.owner === 'ChartOptions' ? '' : alternative.owner.replace(/Options?$/, '');
          list.push({ name: identifier(core + alternative.property + pascal(value) + 'Option'), strength: STRENGTH.discriminator });
        }

        const source = input.sourceTypes ?? input.types;
        const upstream = declarations.map(d => upstreamName(source, source.get(d) ?? input.types.get(d), input.alias)).find(Boolean);
        const shared = contexts.length > 1;
        if (upstream && shared)
          list.push({ name: identifier(upstream + signature), strength: STRENGTH.upstream });

        if (shared && contexts.every(h => h.property)) {
          // A shared type without an upstream name is named after the property it fills (Baseline, AnimationDelay),
          // then qualified by the words every owner has in common (EmphasisFocus).
          const property = commonPrefix(contexts.map(h => words(h.property + h.suffix)));
          if (property.length) {
            const kind = input.kinds.get(id) === 'model' && !property.join('').endsWith('Option') ? 'Option' : signature;
            list.push({ name: identifier(property.join('') + kind), strength: STRENGTH.property });
            const owners = contexts.map(h => words(h.owner === 'ChartOptions' ? '' : h.owner.replace(/Options?$/, '')));
            const qualifier = owners[0].filter((w, i) => owners[0].indexOf(w) === i && owners.every(o => o.includes(w)) && !property.includes(w));
            if (qualifier.length)
              list.push({ name: identifier(qualifier.join('') + property.join('') + kind), strength: STRENGTH.qualified });
          }
        }

        for (const h of contexts)
          list.push({ name: identifier(hintText(h).replace(/(Signature)?$/, signature)), strength: STRENGTH.context });

        if (upstream && !shared)
          list.push({ name: identifier(upstream + signature), strength: STRENGTH.fallback });

        if (!list.length)
          list.push({ name: input.provisional.get(id)!, strength: STRENGTH.fallback });
      }

      const allowed = list.filter(
        (c, i) => list.findIndex(o => o.name === c.name) === i && (c.strength === STRENGTH.fixed || !reserved.has(c.name.toLowerCase()))
      );
      candidates.set(id, allowed.length ? allowed : [{ name: input.provisional.get(id)!, strength: STRENGTH.fallback }]);
    }

    const next = resolve(input.order, candidates);
    moving = input.order.filter(id => final.get(id) !== next.names.get(id));
    final = next.names;
    unresolved = next.unresolved;
    if (!moving.length)
      break;
  }

  if (moving.length)
    throw new Error(`CSHARP_NAME_UNSTABLE no fixed point after 32 rounds: ${moving.map(id => `${id} (${final.get(id)})`).join(', ')}. Add csharp.names entries with a reason.`);

  const routes = new Map<string, Set<string>>();
  for (const id of input.order)
    for (const h of input.contexts.get(id) ?? [])
      if (h.union) {
        const route = routeKey({ ...h, owner: final.get(byProvisional.get(h.owner) ?? '') ?? h.owner }, input.types.get(id), input.types);
        (routes.get(route) ?? routes.set(route, new Set()).get(route)!).add(id);
      }

  const ambiguous = [...routes].filter(([, ids]) => ids.size > 1);
  if (ambiguous.length)
    throw new Error(`TYPE_NAME_LOCK alternatives share a route: ${ambiguous.map(([route, ids]) => `${route} (${[...ids].join(', ')})`).join('; ')}. Add csharp.names entries with a reason.`);

  if (conflicts.size)
    throw new Error(`TYPE_NAME_LOCK one type reached through routes of several locked names: ${[...conflicts].map(([id, names]) => `${id} (${names.join(', ')})`).join('; ')}`);

  if (unresolved.length)
    throw new Error(`CSHARP_NAME_COLLISION ${unresolved.join('; ')}. Add csharp.names entries with a reason.`);

  return final;
}

function resolve(order: string[], candidates: Map<string, Candidate[]>): { names: Map<string, string>; unresolved: string[] } {
  const position = new Map(order.map(id => [id, 0]));
  let unresolved: string[] = [];
  for (; ;) {
    const claims = new Map<string, string[]>();
    for (const id of order) {
      const c = candidates.get(id)![position.get(id)!];
      if (!c)
        continue;

      (claims.get(c.name) ?? claims.set(c.name, []).get(c.name)!).push(id);
    }

    let moved = false;
    unresolved = [];
    for (const [name, ids] of claims) {
      if (ids.length < 2)
        continue;

      const strength = (id: string) => candidates.get(id)![position.get(id)!].strength;
      const canMove = (id: string) => !!candidates.get(id)![position.get(id)! + 1];

      // A type whose last candidate this is keeps it; otherwise the strongest claim wins and ties all move on.
      const stuck = ids.filter(id => !canMove(id));
      const top = Math.max(...ids.map(strength));
      const winners = stuck.length === 1 ? stuck : ids.filter(id => strength(id) === top);
      const losers = (winners.length === 1 ? ids.filter(id => id !== winners[0]) : ids).filter(canMove);
      for (const id of losers) {
        position.set(id, position.get(id)! + 1);
        moved = true;
      }

      if (!losers.length)
        unresolved.push(`${name}: ${ids.join(', ')}`);
    }

    if (!moved)
      break;
  }

  return { names: new Map(order.map(id => [id, candidates.get(id)![position.get(id)!].name])), unresolved };
}
