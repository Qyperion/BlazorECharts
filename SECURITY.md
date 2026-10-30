# Security policy

## Supported versions

Security fixes go to the latest released version of `Qyperion.BlazorECharts` and
`Qyperion.BlazorECharts.WordCloud`.
Both packages are released together with the same version.

## Reporting a vulnerability

Report a vulnerability privately with **Report a vulnerability** on the repository's **Security**
tab (GitHub private vulnerability reporting). Do not open a public issue or pull request for it.

Include the affected version, the render mode (Server, WebAssembly, Auto or standalone), a minimal
reproduction and the impact you expect. You get an acknowledgement after the report is triaged; a fix
is released as a new patch version, and the advisory is published with it.

## Scope

In scope: the C# library, the JavaScript runtime it ships, the packaged assets and the release tools
in `tools/Release`. Vulnerabilities in Apache ECharts, ZRender, tslib or `@qyperion/echarts-wordcloud`
(Qyperion/echarts-wordcloud) belong to their projects; report them there, and tell us if the packaged version is affected.

[Security](docs/security.md) describes how to use charts safely: the ECharts features that insert
HTML or open links, inline functions, which are off unless `AllowInlineJavaScript` is set, and the
Content Security Policy for each render mode.
