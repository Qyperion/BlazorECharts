import { existsSync, readFileSync } from 'node:fs';
import { hash } from './resolve-types.ts';

interface DocNode {
  description?: string;
  properties?: Record<string, DocNode>;
}

export interface ApiDoc {
  summary?: string;
  href: string;
}

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&amp;', '&');

/** The first sentence of an echarts-doc description: its first paragraph of text, without the ACTION/EVENT cross-link. */
export function firstSentence(html: string): string | undefined {
  for (const [, paragraph] of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const text = decode(paragraph.replace(/^\s*<strong>(ACTION|EVENT):\s*<\/strong>\s*(<a [^>]*>[^<]*<\/a>)?/, '').replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text)
      continue;

    const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
    return sentence.endsWith('.') ? sentence : sentence + '.';
  }

  return undefined;
}

/**
 * The echarts-doc API text of an event or action record, from the pinned snapshot that `npm run docs:acquire` writes.
 * The description must hash to the schema's `descriptionHash`: a snapshot of another echarts-doc commit is an error, not other docs.
 */
export function apiDocs(path = 'artifacts/generator/docs/api.json') {
  if (!existsSync(path))
    throw new Error(`Missing echarts-doc API snapshot ${path}: run npm run docs:acquire.`);

  const root = (JSON.parse(readFileSync(path, 'utf8')) as { option: DocNode }).option;
  const node = (path: string) => path.split('.').reduce<DocNode | undefined>((n, key) => n?.properties?.[key], root);
  return (publicPath: string, descriptionHash?: string): ApiDoc | undefined => {
    // The nine mouse events are records of their own under the "Mouse events" heading.
    const path = [publicPath, publicPath.replace(/^events\./, 'events.Mouse events.')].find(p => node(p));
    if (!path)
      return undefined;

    const description = node(path)!.description ?? '';
    if (descriptionHash && hash(description) !== descriptionHash)
      throw new Error(`Stale echarts-doc API snapshot at ${publicPath}: run npm run docs:acquire.`);

    return { summary: firstSentence(description), href: 'https://echarts.apache.org/en/api.html#' + path.replaceAll(' ', '%20') };
  };
}
