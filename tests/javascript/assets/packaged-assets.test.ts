import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path);
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const lock = json('schemas/upstream/sources.lock.json');
const echarts = lock.packages.find((p: { name: string }) => p.name === 'echarts');

describe('packaged ECharts runtime', () => {
  const manifest = json('src/BlazorECharts/wwwroot/js/assets-manifest.json');
  const engine = read('src/BlazorECharts/wwwroot/js/echarts-6.1.0.js');

  it('CoreEngine_IsTheLockedMinifiedBuild', () => {
    // Act
    const minified = echarts.files['dist/echarts.esm.min.mjs'];

    // Assert
    expect(minified).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(engine)).toBe(minified);
    expect(manifest.runtime.sourceSha256).toBe(minified);
  });

  it('CoreEngine_HasNoDevelopmentBranchesOrSourceMap', () => {
    // Act
    const text = engine.toString('utf8');

    // Assert
    expect(text).not.toContain('"development" !== ');
    expect(text).not.toContain('sourceMappingURL');
  });
});

describe('packaged WordCloud notices', () => {
  const root = 'src/BlazorECharts.WordCloud/wwwroot/';
  const manifest = json(root + 'js/assets-manifest.json');
  const paths: string[] = manifest.files.map((f: { path: string }) => f.path);
  const notices = readFileSync('THIRD-PARTY-NOTICES.md', 'utf8');

  it('WordCloudNotices_CarryTheLicenseOfThePackage', () => {
    // Act & Assert
    expect(paths).toContain('notices/echarts-wordcloud/LICENSE');
    expect(paths).not.toContain('notices/wordcloud2.js/LICENSE');

    // Act
    const license = readFileSync(root + 'notices/echarts-wordcloud/LICENSE', 'utf8');

    // Assert
    expect(read(root + 'notices/echarts-wordcloud/LICENSE')).toEqual(read('artifacts/upstream/echarts-wordcloud/LICENSE'));
    expect(license).toContain('Permission to use, copy, modify, and/or distribute this software for any');
    expect(license).toContain('Copyright 2011 - 2019 Tim Guan-tin Chien and contributors.');
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR');
    expect(notices).toContain(license.trimEnd());
  });

  it('WordCloudNotices_OmitTheLayoutSource', () => {
    // Act & Assert
    expect(paths.filter(p => p.startsWith('notices/echarts-wordcloud/src/'))).toEqual([]);
    expect(manifest.package.notices).toEqual(['LICENSE']);
  });
});
