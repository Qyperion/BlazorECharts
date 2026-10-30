import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generateWordCloud } from '../../../tools/BindingGenerator/src/wordcloud.ts';

it('WordCloudInventory_RejectsUnmappedDeclarationsAndMissingInheritedFields', async () => {
  // Arrange
  const mappings = JSON.parse(await readFile('schemas/overrides/wordcloud-3.0.0.json', 'utf8'));
  delete mappings.models.WordCloudTextStyle.properties.borderDashOffset;

  // Act & Assert
  await expect(generateWordCloud(mappings)).rejects.toThrow(/borderDashOffset/);

  // Arrange
  const second = JSON.parse(await readFile('schemas/overrides/wordcloud-3.0.0.json', 'utf8'));
  delete second.models.WordCloudSeriesOption.properties.animationDelayUpdate;

  // Act & Assert
  await expect(generateWordCloud(second)).rejects.toThrow(/animationDelayUpdate/);
});

it('WordCloudInventory_AllPropertiesHaveSourceAndRoundTripFixtures', async () => {
  // Arrange
  const result = await generateWordCloud();

  // Act
  const fixtures = JSON.parse(await readFile('tests/BlazorECharts.Tests/WordCloud/wordcloud-models.json', 'utf8'));

  // Assert
  for (const record of result.inventory.records) {
    expect(record.source.file, record.id).toBeTruthy();
    if (record.status === 'omitted')
      continue;

    expect(record.source.line, record.id).toBeGreaterThan(0);
    expect(record.source.sha256, record.id).toMatch(/^[a-f0-9]{64}$/);
    const fixture = fixtures.find(f => f.model === record.model);
    expect(Object.hasOwn(fixture.json, record.name), record.id).toBe(true);
  }

  expect(result.inventory.unresolved).toEqual([]);
  expect(result.inventory.records.some(r => r.name === 'keepAspect')).toBe(true);
  expect(result.inventory.records.some(r => r.name === 'shrinkToFit')).toBe(true);
  for (const name of ['randomSeed', 'z', 'zlevel']) {
    const record = result.inventory.records.find(r => r.model === 'WordCloudSeriesOption' && r.name === name)!;
    expect(record.status, name).toBe('generated');
    expect(record.source.file, name).toBe('echarts-wordcloud/index.d.ts');
  }

  for (const name of ['focus', 'blurScope', 'textStyle', 'disabled']) {
    const source = result.inventory.records.find(r => r.model === 'WordCloudState' && r.name === name)!.source;
    expect(source.text, name).toMatch(new RegExp(name + '\\??\\s*:'));
  }
});

it('WordCloudArtifact_MatchesProofProvenance', async () => {
  // Arrange
  const lock = JSON.parse(await readFile('schemas/upstream/sources.lock.json', 'utf8'));
  const bytes = await readFile('src/BlazorECharts.WordCloud/wwwroot/js/wordcloud-installer.js');

  // Act & Assert
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(lock.packages.find((p: { name: string }) => p.name === '@qyperion/echarts-wordcloud').installer.sha256);

  // Act
  const meta = JSON.parse(await readFile('artifacts/assets/wordcloud-metafile.json', 'utf8'));

  // Assert
  expect(Object.keys(meta.inputs).every(p => p.startsWith('src/BlazorECharts.WordCloud/JavaScript/'))).toBe(true);
});

it('WordCloudCoverage_RejectsRuntimeOmissionsAndNarrowedCoreAlternatives', async () => {
  // Act & Assert
  for (const name of ['rich', 'richInheritPlainLabel', 'overflow', 'lineOverflow', 'ellipsis', 'minMargin', 'textMargin']) {
    const mappings = JSON.parse(await readFile('schemas/overrides/wordcloud-3.0.0.json', 'utf8'));
    delete mappings.models.WordCloudTextStyle.properties[name];
    await expect(generateWordCloud(mappings)).rejects.toThrow(new RegExp(name));
  }

  // Arrange
  const mappings = JSON.parse(await readFile('schemas/overrides/wordcloud-3.0.0.json', 'utf8'));
  mappings.models.WordCloudTextStyle.properties.borderType = 'string';

  // Act & Assert
  await expect(generateWordCloud(mappings)).rejects.toThrow(/borderType.*alternatives/);
});

it('WordCloudTooltip_UsesCoreSeriesTooltipAndItemStringForm', async () => {
  // Act
  const result = await generateWordCloud();

  // Assert
  for (const model of ['WordCloudSeriesOption', 'WordCloudDataItem']) {
    const record = result.inventory.records.find(r => r.model === model && r.name === 'tooltip');
    expect(record, model).toBeTruthy();
    expect(record!.source.file).toBe('echarts/lib/component/tooltip/TooltipView.js');
    expect(record!.source.text).toContain('data.getItemModel(dataIndex), dataModel');
  }

  expect(result.files.get('src/BlazorECharts.WordCloud/Options/Generated/WordCloudSeriesOption.g.cs')).toContain(
    'public SeriesTooltipOption? Tooltip'
  );
  expect(result.files.get('src/BlazorECharts.WordCloud/Options/Generated/WordCloudDataItem.g.cs')).toContain('public WordCloudDataTooltip? Tooltip');

  // Act
  const union = result.files.get('src/BlazorECharts.WordCloud/Options/Generated/WordCloudDataTooltip.g.cs')!;

  // Assert
  expect(union).toContain('public static WordCloudDataTooltip From(string value)');
  expect(union).toContain('public static WordCloudDataTooltip From(SeriesTooltipOption value)');
});

it('WordCloudGeneration_StaleGeneratedFileFails', async () => {
  // Arrange
  const { writeWordCloudGeneration } = await import('../../../tools/BindingGenerator/src/wordcloud.ts');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { join, resolve } = await import('node:path');
  const dir = await mkdtemp(resolve('artifacts/generator/wordcloud-stale-'));
  try {
    const files = new Map([
      ['src/BlazorECharts.WordCloud/Options/Generated/Kept.g.cs', 'kept'],
      ['schemas/generated/wordcloud-public-api.txt', 'api'],
    ]);
    await writeWordCloudGeneration(files, dir, false);
    await writeWordCloudGeneration(files, dir, true);
    const stale = join(dir, 'src/BlazorECharts.WordCloud/Serialization/Generated/Removed.g.cs');
    await mkdir(join(stale, '..'), { recursive: true });
    await writeFile(stale, 'removed model');

    // Act & Assert
    await expect(writeWordCloudGeneration(files, dir, true)).rejects.toThrow(
      'Stale generated file: src/BlazorECharts.WordCloud/Serialization/Generated/Removed.g.cs'
    );

    // Act
    await writeWordCloudGeneration(files, dir, false);

    // Assert
    expect(existsSync(stale)).toBe(false);

    // Arrange
    // In the directories shared with the core generation only the wordcloud- files are WordCloud's.
    await writeFile(join(dir, 'schemas/generated/public-api.txt'), 'core');
    await writeFile(join(dir, 'schemas/generated/wordcloud-old.json'), 'old');
    await mkdir(join(dir, 'schemas/upstream'), { recursive: true });
    await writeFile(join(dir, 'schemas/upstream/sources.lock.json'), 'lock');
    await writeFile(join(dir, 'schemas/upstream/wordcloud-old.api.json'), 'old');

    // Act & Assert
    await expect(writeWordCloudGeneration(files, dir, true)).rejects.toThrow('Stale generated file: schemas/generated/wordcloud-old.json');
    await expect(writeWordCloudGeneration(new Map([...files, ['schemas/generated/wordcloud-old.json', 'old']]), dir, true)).rejects.toThrow(
      'Stale generated file: schemas/upstream/wordcloud-old.api.json'
    );

    // Act
    await writeWordCloudGeneration(files, dir, false);

    // Assert
    expect([
      existsSync(join(dir, 'schemas/generated/wordcloud-old.json')),
      existsSync(join(dir, 'schemas/upstream/wordcloud-old.api.json')),
      existsSync(join(dir, 'schemas/generated/public-api.txt')),
      existsSync(join(dir, 'schemas/upstream/sources.lock.json')),
    ]).toEqual([
      false, false, true, true,
    ]);

    // Arrange
    await writeFile(join(dir, 'src/BlazorECharts.WordCloud/Options/Generated/Kept.g.cs'), 'drift');

    // Act & Assert
    await expect(writeWordCloudGeneration(files, dir, true)).rejects.toThrow(/WordCloud generated drift/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('WordCloudInheritedNoOps_AreOmittedWithAReasonAndParityMembersHaveRemarks', async () => {
  // Arrange
  const result = await generateWordCloud();

  // Act
  const omitted: Record<string, string[]> = {
    WordCloudSeriesOption: [
      'select', 'animationThreshold', 'animationDuration', 'animationDurationUpdate', 'animationDelay', 'animationDelayUpdate', 'animationEasing',
      'animationEasingUpdate', 'progressive', 'progressiveThreshold', 'progressiveChunkMode', 'hoverLayerThreshold', 'seriesLayoutBy', 'labelLine',
      'labelLayout', 'universalTransition', 'dataGroupId', 'coordinateSystem', 'coordinateSystemUsage', 'coord',
    ],
    WordCloudDataItem: ['select', 'groupId', 'childGroupId'],
    WordCloudState: ['disabled'],
  };

  // Assert
  for (const [model, names] of Object.entries(omitted)) {
    const code = result.files.get(`src/BlazorECharts.WordCloud/Options/Generated/${model}.g.cs`)!;
    for (const name of names) {
      const record = result.inventory.records.find(r => r.model === model && r.name === name);
      expect(record?.status, `${model}.${name}`).toBe('omitted');
      expect(record!.mapping.slice(5).trim().length, `${model}.${name}`).toBeGreaterThan(10);
      expect(code, `${model}.${name}`).not.toMatch(new RegExp(String.raw`public \S+ ${name[0].toUpperCase() + name.slice(1)} \{`));
    }
  }

  // Act
  const series = result.files.get('src/BlazorECharts.WordCloud/Options/Generated/WordCloudSeriesOption.g.cs')!;

  // Assert
  for (const name of ['Cursor', 'BlendMode'])
    expect(series).toMatch(
      new RegExp(String.raw`/// <remarks>No effect in @qyperion/echarts-wordcloud 3\.0\.0: [^<]+</remarks>\n    public string\? ${name} \{`)
    );

  expect(series).not.toMatch(/<remarks>[^\n]*\n    public \S+ (Silent|Animation|StateAnimation) \{/);

  // Arrange
  const empty = JSON.parse(await readFile('schemas/overrides/wordcloud-3.0.0.json', 'utf8'));
  empty.models.WordCloudSeriesOption.properties.coord = 'omit: ';

  // Act & Assert
  await expect(generateWordCloud(empty)).rejects.toThrow(/WordCloudSeriesOption\.coord.*reason/);

  // Arrange
  const unknown = JSON.parse(await readFile('schemas/overrides/wordcloud-3.0.0.json', 'utf8'));
  unknown.noEffect['WordCloudSeriesOption.coord'] = 'Omitted members cannot carry remarks.';

  // Act & Assert
  await expect(generateWordCloud(unknown)).rejects.toThrow(/WordCloudSeriesOption\.coord/);
});

it('WordCloudCommonSeriesFields_UseTheCoreTypes', async () => {
  // Arrange
  const result = await generateWordCloud();

  // Act
  const series = result.files.get('src/BlazorECharts.WordCloud/Options/Generated/WordCloudSeriesOption.g.cs')!;

  // Assert
  for (const name of ['Width', 'Height', 'Top', 'Right', 'Bottom', 'Left'])
    expect(series).toContain(`public NumberOrString? ${name} {`);

  expect(series).toContain('public ZRColor?[]?[]? ColorLayer {');
  expect(series).toContain('public AnimationOption? StateAnimation {');
  expect(series).toContain('public SeriesSelectedMode? SelectedMode {');
  expect(series).toContain('public NumberOrString? RandomSeed {');
  expect(series).toContain('public double? Z {');
  expect(series).toContain('public double? Zlevel {');
  for (const model of ['WordCloudTextStyle', 'WordCloudItemTextStyle']) {
    const code = result.files.get(`src/BlazorECharts.WordCloud/Options/Generated/${model}.g.cs`)!;
    for (const name of ['FontWeight', 'FontSize', 'Width'])
      expect(code, `${model}.${name}`).toContain(`public NumberOrString? ${name} {`);
  }

  // Act
  const orphans = [
    'WordCloudNumberOrString', 'WordCloudPaint', 'WordCloudGradient', 'WordCloudPattern', 'WordCloudColorStop', 'WordCloudStateAnimation',
    'WordCloudSelectedMode', 'WordCloudDuration', 'WordCloudDurationSignature', 'WordCloudDelay', 'WordCloudDelaySignature', 'WordCloudProgressive',
    'WordCloudLabelLineOption', 'WordCloudLineStyle', 'WordCloudSmooth', 'WordCloudLabelLayout', 'WordCloudLabelLayoutOption',
    'WordCloudLabelLayoutSignature', 'WordCloudTransition', 'WordCloudUniversalTransition', 'WordCloudTransitionDelaySignature',
    'WordCloudStringOrStrings',
  ];

  // Assert
  for (const name of orphans)
    expect(result.files.has(`src/BlazorECharts.WordCloud/Options/Generated/${name}.g.cs`), name).toBe(false);
});
