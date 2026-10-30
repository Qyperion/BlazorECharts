import { header, quote, type Shape } from './generation-model.ts';

const parameters = (shape: Shape) => {
  const names = [...new Set((shape.signatures ?? []).flatMap(s => s.parameters.map(p => p.name)))];
  return names.length ? ` with the parameters ${names.map(n => `<c>${n}</c>`).join(', ')}` : ' without parameters';
};

export function emitSignature(shape: Shape): string {
  return header + `namespace BlazorECharts.Values.Signatures;\n\n/// <summary>Marks a browser callback${parameters(shape)}.</summary>\npublic readonly struct ${shape.name} : IJsFunctionSignature\n{\n    /// <summary>Gets the stable upstream schema type identifier.</summary>\n    public static string Id => ${quote(shape.id)};\n}\n`;
}
