import type { ApiSchema } from './schema.ts';

export type OptionGroup = 'standard' | 'advanced' | 'graphic-custom' | 'wordcloud' | 'components';
const advanced = new Set(['tree', 'treemap', 'sunburst', 'graph', 'chord', 'sankey', 'custom']);

/** Capability group of a documented option path; the family names the generated contract tests. */
export function optionGroup(path: string): { group: OptionGroup; family: string } {
  if (path.startsWith('option.graphic') || path.startsWith('option.series.custom.renderItem'))
    return { group: 'graphic-custom', family: 'graphic-custom' };

  if (path.startsWith('option.series.')) {
    const name = path.split('.')[2];
    if (name === 'wordCloud')
      return { group: 'wordcloud', family: 'wordcloud' };

    return advanced.has(name) ? { group: 'advanced', family: 'advanced-series' } : { group: 'standard', family: 'standard-series' };
  }

  return { group: 'components', family: 'components-coordinate' };
}

export function optionPartition(schema: ApiSchema) {
  return schema.records.filter(r => r.publicPath.startsWith('option.')).map(r => ({ sourceId: r.id, ...optionGroup(r.publicPath) }));
}
