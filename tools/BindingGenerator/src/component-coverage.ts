import type { ApiSchema, TypeNode } from './schema.ts';
import type { CSharpConfiguration, ManifestEntry, Shape } from './generation-model.ts';
import { componentRoute } from './component-routes.ts';
import { optionGroup, type OptionGroup } from './option-partition.ts';

export function componentEntries(
  schema: ApiSchema,
  config: CSharpConfiguration,
  types: Map<string, TypeNode>,
  shapes: Map<string, Shape>,
  group: OptionGroup = 'components'
): ManifestEntry[] {
  const root = schema.records.find(r => r.id === config.roots[0].recordId)!.type;
  const entries: ManifestEntry[] = [];
  for (const r of schema.records.filter(r => r.publicPath.startsWith('option.') && optionGroup(r.publicPath).group === group)) {
    const edges = componentRoute(types, root, r.publicPath, config.componentVariants, config.optionRouteAliases);
    const targets = edges.map(e => {
      const parent = shapes.get(e.parent);
      const member = parent?.properties?.find(p => p.name === e.name);
      if (e.name === 'type' && parent?.discriminator && parent.file)
        return {
          typeId: e.type,
          symbol: `${parent.name}.Type`,
          file: parent.file,
          serializer: `GeneratedOptionMetadata.Write${parent.name}`,
          reader: `GeneratedOptionMetadata.Read${parent.name}`,
        };

      const model = member || parent?.kind === 'tuple' ? parent : shapes.get(e.type);
      if (!model?.name || !model.file || !['model', 'union', 'tuple'].includes(model.kind))
        return undefined;

      return {
        typeId: e.type,
        symbol: member ? `${model.name}.${member.csName}` : model.name,
        file: model.file,
        serializer: model.kind === 'model' ? `GeneratedOptionMetadata.Write${model.name}` : `${model.name}.IOptionValue.Write`,
        reader: model.kind === 'model' ? `GeneratedOptionMetadata.Read${model.name}` : `${model.name}.Read`,
      };
    });
    const valid = targets.length > 0 && targets.every(Boolean);
    const first = targets.find(Boolean);
    const source = types.get(r.type)!;
    const family = optionGroup(r.publicPath).family;
    entries.push({
      sourceId: r.id,
      typeId: r.type,
      family,
      families: [family],
      status: valid ? 'generated' : 'unresolved',
      symbol: valid ? first!.symbol : '',
      file: valid ? first!.file : '',
      serializer: valid ? first!.serializer : '',
      reader: valid ? first!.reader : '',
      alternatives: valid ? (source.kind === 'union' ? source.alternatives! : [source.id]) : [],
      ...(valid ? { targets: targets as NonNullable<typeof first>[] } : { reason: 'No complete typed projection for the documented route.' }),
    });
  }

  return entries;
}
