# Third-party notices

BlazorECharts is licensed under the MIT License (see `LICENSE`). The NuGet packages
also distribute the unmodified or adapted third-party JavaScript listed below. Each
package carries the original license and notice files under `staticwebassets/notices/`,
served at `_content/BlazorECharts/notices/` and `_content/BlazorECharts.WordCloud/notices/` in a
running application.

## Qyperion.BlazorECharts package

| Component | Version | License | Source | Distributed as |
|---|---|---|---|---|
| Apache ECharts | 6.1.0 | Apache-2.0 | https://github.com/apache/echarts | `js/echarts-6.1.0.js`, the unmodified `dist/echarts.esm.min.mjs` |
| ZRender | 6.1.0 | BSD-3-Clause | https://github.com/ecomfe/zrender | bundled inside the ECharts module |
| tslib | 2.3.0 | 0BSD | https://github.com/microsoft/tslib | bundled inside the ECharts module |

Apache ECharts NOTICE:

```
Apache ECharts
Copyright 2017-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

License texts: `notices/echarts/LICENSE`, `notices/echarts/NOTICE`, `notices/zrender/LICENSE`,
`notices/tslib/LICENSE.txt`, `notices/tslib/CopyrightNotice.txt`.

## Qyperion.BlazorECharts.WordCloud package

| Component | Version | License | Source | Distributed as |
|---|---|---|---|---|
| @qyperion/echarts-wordcloud | 3.0.0 | ISC | https://github.com/Qyperion/echarts-wordcloud | `js/wordcloud-installer.js` |
| wordcloud2.js (layout bundled by echarts-wordcloud) | as bundled in @qyperion/echarts-wordcloud 3.0.0 | MIT, Copyright 2011-2019 Tim Guan-tin Chien and contributors | http://timdream.org/wordcloud2.js/ | inside `js/wordcloud-installer.js` |

The installer is built from the published npm package without changes; `notices/PROVENANCE.md`
records the archive and the installer with their SHA-256 hashes. The license file of the package,
below, carries the ISC license of echarts-wordcloud and the MIT license of wordcloud2.js, whose
layout `src/layout.js` is based on; it is also served as `notices/echarts-wordcloud/LICENSE`.
ECharts itself comes from the Qyperion.BlazorECharts package.

### @qyperion/echarts-wordcloud

```
ISC License

Copyright (c) the echarts-wordcloud authors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

src/layout.js is based on wordcloud2.js (https://github.com/timdream/wordcloud2.js),
released under the MIT License:

Copyright 2011 - 2019 Tim Guan-tin Chien and contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
