# BIOS runtime compilation: actual-PDF acceptance

2026-10-18. **Bounded visual PASS for the final 24-page DRAFT**, not canonical
publication or technical-source approval. Two independent reviewers inspected
actual rasterized PDF pages; root consolidated their disjoint coverage and
full decoded-pixel identity evidence. No publisher/CSS/framework change.

## Final identity and exact coverage

- Actual PDF: `build/manual/bios-loader.preview.pdf`, SHA-256
  `0b55f4e5025aa3f50d3e262516b3419cd748cd67ce7732d6d2a26ffe98d6ee42`.
- Final chapter source: `ad76bd0f8428176999810405524926eeebb86809297c6ed0e2795e84dbdeafac`.
- 24 pages. Receipt: figures 0, registerEntries 0, layout errors `[]`;
  Chromium 153.0.8010.12, Node v22.23.1, Linux x64.
- Rasterization: GPL Ghostscript 10.06.0, PNG16M, 120 dpi. All final pages rendered
  at `/tmp/bmsx-bios-loader-print-evidence/corrected-2/pages/`.
- [Front reviewer](bios-loader-print-front.md): final 1–13. Final 9–13 each
  individually viewed at original detail; full decoded RGBA equality confirms
  final 1–8 equal their previously individually viewed counterparts.
- [Tail reviewer](bios-loader-print-tail.md): final 14–24. Final 17, 18, 20, 21 each
  individually viewed at original detail; full decoded RGBA equality confirms
  final 14–16,19,22–24 equal previously individually viewed corrected pages.
- Exact union: **1–24 inclusive**. Nine changed pages individually viewed plus
  fifteen full-page pixel-identical evidence reuses; no unviewed changed page.
- Root comparison: `corrected-2/pixel-identity.json`, ImageMagick full decoded
  8-bit RGBA SHA-256, against all actually viewed initial/corrected pages.
  Front independently retained byte-level RGBA comparisons as well. Same text,
  matching page number or source hash alone was not accepted as page identity.

## Eight observed findings, all closed

| Observed detached group | Final visual disposition |
| --- | --- |
| Initial5→6: binary-precedence introduction/table | Together6; full final-page identity reuses corrected visual pass. |
| Initial7→8: Calls and results heading/intro/table | Together8; full final-page identity reuses corrected pass. |
| Initial14→15: exported node constants heading/intro/table | Together15; final page equals actually viewed corrected15. |
| Initial16→17: binding-condition introduction/table | Closed in first correction; final17 individually rechecked without a new split. |
| Corrected9→10: compile_syntax lead/signature/argument table | Together10, individually viewed final. |
| Corrected12→13: numeric-loop heading/lead/signature | Together13, complete indented signature and explanation individually viewed. |
| Corrected17→18: compiler-owned-fields introduction/table | Together18, individually viewed final. |
| Corrected20→21: Results module heading/intro/listing | Together21; complete source listing and entry part1 fit, individually viewed. |

Eight existing `keep-together` groups only. The equivalent Markdown hard break
uses a backslash instead of trailing spaces. Removing those groups and
restoring that one spelling reproduces source/reader-accepted technical
SHA-256 `4588aa55cf58ae6ad0c9d7567020db578b1db99594fde6908f2adc8136abc9c8`.
All160 literal programme lines remain unchanged. The reset subsection was
separately source/public-reader accepted before these final layout changes.

## Remaining visual result and review correction

No remaining clipping, colliding/broken table rows, unusable signatures,
lost code indentation/continuations, missing formula glyphs or long-diagnostic
overflow was observed within this complete page coverage. The new reset text,
resource multiplication/ceiling marks, complete programme and observations
remain readable. Sequential numbering and Book II software running identity /
DRAFT treatment are retained. The final printed artifact remains a draft.

An initial tiny-view impression of missing margin titles on overflow pages
was explicitly withdrawn after enlarged inspection of the exact page2 PNG:
root and reviewer images are byte-identical and show the running title and
chapter/DRAFT footer. It was not a publisher defect and caused no code change.

Initial PDF 23 pages SHA 6ae19e24e42b8faae2fea8bdbb25c04f68e237c2e6a69a35198443b902c43cb1;
first corrected 24 pages SHA 24887e3832facad7adc5e0396c17b942309b86047852c43b56ba8040e53d37ef.
Their exact findings, page views and correction chronology remain in the two
reviewer reports. RL01/common Table-length source questions stay open despite
this visual pass; there is no native/all-input/whole-manual or SDK approval.
