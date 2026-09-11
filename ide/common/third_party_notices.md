Browser graph-layout.worker.js includes elkjs 0.12.0 byte-for-byte.
Node graph-layout.node-worker.cjs bundles the same upstream endpoint plus
the BMSX Node transport bridge. The upstream engine is by Kiel
University and other Eclipse Layout Kernel contributors. Distributed under
the Eclipse Public License 2.0; see elkjs.LICENSE.txt supplied with this product.

Source revision recorded in the published package metadata:
https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c
Exact published package (JavaScript, typings and copyright notices):
https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz

The browser Studio UI, Node main thread and BMSX machine do not contain the
ELK engine. Node worker bundling changes packaging, not the upstream code.

---

`ide/common/word_matcher.ts` adapts the word-boundary recurrence from VS Code
`src/vs/base/common/filters.ts` (`matchesWords`), revision
7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca. BMSX uses retained iterative storage
and restores matching character positions from that retained matrix. It does not
include VS Code accent normalization or input-method transliteration.
The matching conformance oracle retains the ASCII branches of the original
recursive implementation.

Source: https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/filters.ts

`ide/common/fuzzy_scorer.ts` adapts the non-contiguous `scoreFuzzy` recurrence
from the same revision's `src/vs/base/common/fuzzyScorer.ts`. The file Quick Pick
provider applies its path identity, basename prefix/name, and path scoring
priorities. BMSX retains matrix/position storage and relates case-folded indices
to original text. `tests/helpers/vscode_fuzzy_scorer.ts` preserves the original
recurrence as the score-and-position conformance oracle.

Source: https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/fuzzyScorer.ts

`ide/common/fuzzy_symbol_scorer.ts` adapts the same revision's `fuzzyScore`
recurrence in `filters.ts`, using the weak-first/full-match policy of
`scoreFuzzy2`. Its minimum/maximum bounds, gap penalties and alignment restoration
are retained; BMSX replaces the fixed 128-character tables with retained dynamic
storage. The separator predicate includes the same `strings.ts` imprecise emoji
classification. `tests/helpers/vscode_fuzzy_symbol_scorer.ts` retains the original
recurrence and bound as the score/position oracle. Quick Input's retained
field-local highlight union follows `fuzzyScorer.ts`'s `normalizeMatches` sweep.

MIT License

Copyright (c) 2015 - present Microsoft Corporation

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
