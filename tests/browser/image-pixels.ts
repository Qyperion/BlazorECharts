import type { Page } from '@playwright/test';

/** Decodes an exported image in the page and counts its opaque pixels within `tolerance` of a CSS color per channel. */
export function countColorPixels(page: Page, image: string, color: string, tolerance = 40): Promise<number> {
  return page.evaluate(
    async ({ image, color, tolerance }) => {
      const rgb = (() => {
        const c = document.createElement('canvas').getContext('2d')!;
        c.fillStyle = color;
        c.fillRect(0, 0, 1, 1);
        return c.getImageData(0, 0, 1, 1).data;
      })();
      const decoded = new Image();
      decoded.src = image;
      await decoded.decode();
      const canvas = document.createElement('canvas');
      canvas.width = decoded.naturalWidth;
      canvas.height = decoded.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(decoded, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3] > 200 && [0, 1, 2].every(c => Math.abs(data[i + c] - rgb[c]) <= tolerance))
          count++;

      return count;
    },
    { image, color, tolerance }
  );
}

/** Parses SVG markup in the page and counts its path and rect elements filled with a CSS color, as a renderer or an export writes them. */
export function countFilledShapes(page: Page, markup: string, color: string): Promise<number> {
  return page.evaluate(
    ({ markup, color }) => {
      const context = document.createElement('canvas').getContext('2d')!;
      const normalize = (value: string) => {
        context.fillStyle = '#000001';
        context.fillStyle = value;
        return context.fillStyle;
      };
      const expected = normalize(color);
      const svg = new DOMParser().parseFromString(markup, 'image/svg+xml');
      if (svg.querySelector('parsererror'))
        throw new Error('The SVG markup does not parse.');

      return [...svg.querySelectorAll('path, rect')].filter(element => {
        const fill = element.getAttribute('fill') ?? element.getAttribute('style')?.match(/(?:^|;)\s*fill:\s*([^;]+)/)?.[1];
        return !!fill && fill !== 'none' && normalize(fill.trim()) === expected;
      }).length;
    },
    { markup, color }
  );
}
