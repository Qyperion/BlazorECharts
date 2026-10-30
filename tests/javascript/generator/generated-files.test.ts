import { describe, expect, it } from 'vitest';
import { staleActions } from '../../../tools/BindingGenerator/src/generated-files.ts';

describe('stale generated files', () => {
  const generated = 'src/BlazorECharts/Options/Generated/';

  it('Generator_CaseOnlyRename_OnCaseInsensitiveFileSystem_RenamesTheOldFile', () => {
    // Writing Foo.cs over foo.cs keeps the old name there; the listing shows only foo.cs.

    // Act & Assert
    expect(staleActions([generated + 'fooOption.cs'], [generated + 'FooOption.cs'])).toEqual([
      { path: generated + 'fooOption.cs', rename: generated + 'FooOption.cs' },
    ]);
  });

  it('Generator_CaseOnlyRename_OnCaseSensitiveFileSystem_RemovesTheOldFile', () => {
    // On Linux the new file was written next to the old one; renaming the old one over it would restore the old content.

    // Act & Assert
    expect(staleActions([generated + 'FooOption.cs', generated + 'fooOption.cs'], [generated + 'FooOption.cs'])).toEqual([
      { path: generated + 'fooOption.cs', remove: true },
    ]);
  });

  it('Generator_FileWithoutGeneration_IsRemoved', () => {
    // Act & Assert
    expect(staleActions([generated + 'Kept.cs', generated + 'Removed.cs'], [generated + 'Kept.cs'])).toEqual([
      { path: generated + 'Removed.cs', remove: true },
    ]);
  });
});
