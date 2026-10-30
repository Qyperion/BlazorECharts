import { afterEach, beforeEach, expect, test } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkDocs, defaultConfig } from '../../../tools/Docs/check.ts';

let root: string;

const write = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

const config = { documents: ['README.md', 'docs/*.md'], exclude: [], internal: ['.plans'], snippets: ['examples'] };
const check = (fix = false) => checkDocs(root, config, fix);
const codes = (result: { errors: string[] }) => result.errors.map(e => e.split(' ')[0]);

const program = [
  'namespace Docs;',
  'public static class Setup',
  '{',
  '    public static void Run()',
  '    {',
  '        // snippet: Setup.Run',
  '        var answer = 42;',
  '        System.Console.WriteLine(answer);',
  '        // endsnippet',
  '    }',
  '}',
].join('\n');

const component = ['@* snippet: Setup.Markup *@', '<p>@Value</p>', '@* endsnippet *@', '@code { [Parameter] public int Value { get; set; } }'].join(
  '\n'
);

const readme = [
  '# Library', '', 'See [setup](docs/setup.md#install-the-package) and [the site](https://example.test/a:b).', '',
  '<!-- snippet: Setup.Run -->', '```csharp', 'var answer = 42;', 'System.Console.WriteLine(answer);', '```', '',
  '<!-- snippet: Setup.Markup -->', '```razor', '<p>@Value</p>', '```', '',
  '```powershell', 'npm run docs:check', '```', '',
].join('\n');

const setup = ['# Setup', '', '## Install the package', '', 'Back to the [readme](../README.md).', ''].join('\n');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-check-'));
  await write('examples/Setup.cs', program);
  await write('examples/Setup.razor', component);
  await write('README.md', readme);
  await write('docs/setup.md', setup);
  await write('.plans/README.md', '# Plan\n');
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('DocsCheck_ValidDocuments_Pass', () => {
  // Act
  const result = check();

  // Assert
  expect(result.errors).toEqual([]);
  expect(result).toMatchObject({ documents: 2, snippets: 2 });
});

test('DocsCheck_BrokenLinkAndAnchor_Fail', async () => {
  // Act
  await write('docs/setup.md', setup + '\n[missing](missing.md) [bad anchor](../README.md#nope)\n');

  // Assert
  expect(codes(check())).toEqual(['BROKEN_LINK', 'BROKEN_ANCHOR']);
});

test('DocsCheck_InternalPlanLinkAndAbsoluteLocalPath_Fail', async () => {
  // Act
  await write('docs/setup.md', setup + '\nSee [plan](../.plans/README.md). Logs are in W:\\Projects\\Lib\\artifacts and /Users/me/lib.\n');

  // Assert
  expect(codes(check()).sort()).toEqual(['ABSOLUTE_LOCAL_PATH', 'ABSOLUTE_LOCAL_PATH', 'INTERNAL_LINK']);
});

test('DocsCheck_StaleSnippet_FailsAndFixRewritesBlock', async () => {
  // Act
  await write('examples/Setup.cs', program.replace('42', '43'));

  // Assert
  expect(check().errors).toEqual(['STALE_SNIPPET README.md:6 Setup.Run']);
  expect(check(true).errors).toEqual([]);
  expect(await readFile(join(root, 'README.md'), 'utf8')).toContain('var answer = 43;');
  expect(check().errors).toEqual([]);
});

test('DocsCheck_CSharpBlockWithoutSnippetAndUnknownOrUnusedSnippet_Fail', async () => {
  // Act
  await write('docs/setup.md', setup + '\n```csharp\nvar x = 1;\n```\n\n<!-- snippet: Setup.Missing -->\n```csharp\nvar y = 2;\n```\n');
  await write('examples/Extra.cs', '// snippet: Extra.Unused\nvar z = 3;\n// endsnippet\n');

  // Assert
  expect(codes(check()).sort()).toEqual(['MISSING_SNIPPET', 'UNREFERENCED_CODE_BLOCK', 'UNUSED_SNIPPET']);
});

test('DocsCheck_SnippetPartsInOneFile_JoinAndDuplicatesAcrossFilesFail', async () => {
  // Arrange
  const parts = [
    '// snippet: Setup.Program', 'using System;', '// endsnippet', 'namespace Docs;', 'static class P', '{', '    static void Configure()', '    {',
    '        // snippet: Setup.Program', '        Console.WriteLine();', '        // endsnippet', '    }', '}',
  ].join('\n');

  // Act
  await write('examples/Program.cs', parts);
  await write('docs/setup.md', setup + '\n<!-- snippet: Setup.Program -->\n```csharp\nusing System;\n\nConsole.WriteLine();\n```\n');

  // Assert
  expect(check().errors).toEqual([]);

  // Act
  await write('examples/Copy.cs', '// snippet: Setup.Program\nusing System;\n// endsnippet\n');

  // Assert
  expect(check().errors).toEqual(['DUPLICATE_SNIPPET examples/Copy.cs:1 Setup.Program examples/Program.cs:1']);
});

test('DocsCheck_Cli_ExitsNonZeroOnErrors', async () => {
  // Arrange
  const run = () =>
    spawnSync(process.execPath, ['tools/Docs/check.ts', '--root', root, '--config', join(root, 'docs-check.json')], { encoding: 'utf8' });
  await write('docs-check.json', JSON.stringify(config));

  // Act
  const clean = run();

  // Assert
  expect(clean.status, clean.stderr).toBe(0);
  expect(JSON.parse(clean.stdout)).toMatchObject({ documents: 2, snippets: 2, errors: 0 });

  // Act
  await write('docs/setup.md', setup + '\n[missing](missing.md)\n');
  const broken = run();

  // Assert
  expect(broken.status).toBe(1);
  expect(broken.stderr).toContain('BROKEN_LINK docs/setup.md:7 missing.md');
});

test('DocsCheck_DefaultConfig_CoversTheApiCoverageReports', () => {
  // Act & Assert
  expect(defaultConfig.documents).toContain('docs/api-coverage/*.md');
});

test('DocsCheck_JavaScriptBlockWithSyntaxError_Fails', async () => {
  // Arrange
  const valid = [
    '```javascript', "import { getECharts } from '../_content/BlazorECharts/js/blazor-echarts.js';",
    'export function f(params) { return params.name; }', '```',
  ];

  // Act
  await write('docs/setup.md', setup + '\n' + valid.join('\n') + '\n\n```js\nexport function broken(params {\n```\n');

  // Assert
  expect(check().errors).toEqual(["JAVASCRIPT_SYNTAX docs/setup.md:13 ',' expected."]);
});

test('DocsCheck_TypeScriptSyntaxInJavaScriptBlock_Fails', async () => {
  // Act
  await write('docs/setup.md', setup + '\n```javascript\nexport function format(params: { name: string }) { return params.name as string; }\n```\n');

  // Assert
  expect(check().errors).toEqual(['JAVASCRIPT_SYNTAX docs/setup.md:8 Type annotations can only be used in TypeScript files.']);
});

test('DocsCheck_RepositoryUrls_AreCheckedAsLocalPaths', async () => {
  // Arrange
  const repository = 'https://github.com/Owner/Lib';

  // Act
  await write('docs/setup.md', setup + [
    '',
    `[file](${repository}/tree/main/docs/setup.md#install-the-package) [directory](${repository}/tree/main/docs) [blob](${repository}/blob/main/README.md)`,
    `[missing](${repository}/tree/main/docs/missing.md) [anchor](${repository}/blob/main/README.md#nope) [plan](${repository}/tree/main/.plans/README.md)`,
    `[other repository](https://github.com/Other/Lib/tree/main/docs/missing.md) [branch](${repository}/tree/develop/docs/missing.md)`,
    '',
  ].join('\n'));

  // Assert
  expect(checkDocs(root, { ...config, repositoryUrls: [repository] }).errors).toEqual([
    `BROKEN_LINK docs/setup.md:8 ${repository}/tree/main/docs/missing.md`,
    `BROKEN_ANCHOR docs/setup.md:8 ${repository}/blob/main/README.md#nope`,
    `INTERNAL_LINK docs/setup.md:8 ${repository}/tree/main/.plans/README.md`,
  ]);
});

test('DocsCheck_RepositoryUrlsToReleaseTags_AreCheckedAsLocalPaths', async () => {
  // Arrange
  const repository = 'https://github.com/Owner/Lib';

  // Act
  await write('docs/setup.md', setup + [
    '',
    `[tag](${repository}/blob/v1.2.3/docs/setup.md#install-the-package) [prerelease](${repository}/tree/v1.2.3-rc.1/docs)`,
    `[missing](${repository}/blob/v1.2.3/docs/missing.md) [not a version](${repository}/tree/v1/docs/missing.md)`,
    '',
  ].join('\n'));

  // Assert
  expect(checkDocs(root, { ...config, repositoryUrls: [repository] }).errors).toEqual([
    `BROKEN_LINK docs/setup.md:8 ${repository}/blob/v1.2.3/docs/missing.md`,
  ]);
});

test('DocsCheck_PackageNamedByItsProjectName_Fails', async () => {
  // Arrange
  await write('src/Lib/Lib.csproj', '<Project>\n  <PropertyGroup>\n    <PackageId>Owner.Lib</PackageId>\n  </PropertyGroup>\n</Project>\n');
  await write('src/Lib.Extra/Lib.Extra.csproj', '<Project>\n  <PropertyGroup>\n    <PackageId>Owner.Lib.Extra</PackageId>\n  </PropertyGroup>\n</Project>\n');
  await write('src/Tool/Tool.csproj', '<Project />\n');

  // Act
  await write('docs/setup.md', setup + [
    '',
    'Add the `Owner.Lib` package, then the Owner.Lib.Extra package. The `Lib` namespace is in `Lib.dll`; the Tool package keeps its name.',
    '',
    '```bash',
    'dotnet add package Owner.Lib',
    'dotnet add package Lib',
    'dotnet add App.csproj package lib.extra --version 1.0.0',
    '```',
    '',
    'Reference the `Lib` package, the packages `Owner.Lib` and `Lib.Extra`, or the Lib.Extra package on',
    '[nuget.org](https://www.nuget.org/packages/Lib/): `<PackageReference Include="Lib" Version="1.0.0" />`.',
    '',
  ].join('\n'));

  // Assert
  expect(checkDocs(root, { ...config, packageProjects: ['src/*/*.csproj'] }).errors).toEqual([
    'UNPREFIXED_PACKAGE_ID docs/setup.md:11 Lib (the package id is Owner.Lib)',
    'UNPREFIXED_PACKAGE_ID docs/setup.md:12 lib.extra (the package id is Owner.Lib.Extra)',
    'UNPREFIXED_PACKAGE_ID docs/setup.md:15 Lib (the package id is Owner.Lib)',
    'UNPREFIXED_PACKAGE_ID docs/setup.md:15 Lib.Extra (the package id is Owner.Lib.Extra)',
    'UNPREFIXED_PACKAGE_ID docs/setup.md:15 Lib.Extra (the package id is Owner.Lib.Extra)',
    'UNPREFIXED_PACKAGE_ID docs/setup.md:16 Lib (the package id is Owner.Lib)',
    'UNPREFIXED_PACKAGE_ID docs/setup.md:16 Lib (the package id is Owner.Lib)',
  ]);
});

test('DocsCheck_DefaultConfig_ChecksThePackageProjects', () => {
  // Act & Assert
  expect(defaultConfig.packageProjects).toEqual(['src/*/*.csproj']);
});

test('DocsCheck_DefaultConfig_CoversEveryPublicMarkdownFile', () => {
  // Arrange
  const repositoryRoot = join(import.meta.dirname, '..', '..', '..');
  const tracked = spawnSync('git', ['ls-files', '*.md'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const tree: { exclude: string[] } = JSON.parse(readFileSync(join(repositoryRoot, 'tools', 'Release', 'public-tree.json'), 'utf8'));
  const exported = tracked.filter(path => !tree.exclude.some(entry => entry.endsWith('/') ? path.startsWith(entry) : path === entry));

  // Act
  const covered = new Set(
    defaultConfig.documents.flatMap(pattern => globSync(pattern, { cwd: repositoryRoot }).map(path => path.split(sep).join('/')))
  );

  // Assert
  expect(exported.length).toBeGreaterThan(30);
  expect(exported.filter(path => !covered.has(path))).toEqual([]);
});
