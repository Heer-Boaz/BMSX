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

---

The scalable Studio font atlas is derived from JetBrains Mono Regular and Italic
v2.304, distributed under the SIL Open Font License 1.1. The unmodified font
sources are at https://github.com/JetBrains/JetBrainsMono/tree/v2.304.
Atlas generation uses msdfgen-wasm 1.0.0 at build time only.

Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
