# File Quick Access query policy (A06)

The shared picker and its match presentation stay unchanged. This slice concerns
file resources, not symbol resolution.

## Production reference and contract

VS Code at `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:

- [`scoreFuzzy`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/fuzzyScorer.ts#L25-L268)
  scores ordered character matches, adjacency, case, word/path boundaries and
  restores their positions. This implementation has no 128-character cutoff.
- [File item scoring](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/fuzzyScorer.ts#L420-L566)
  distinguishes a full path, basename prefix/name and broader path match. Every
  query term must match. A path query does not acquire a basename-only shortcut.
- [`isPatternInWord`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/filters.ts#L631-L644)
  rejects impossible ordered matches before entering the scoring matrix. This
  is a matching proof, not a timeout, result cap or heuristic omission.

BMSX retains the recurrence's matrix and result positions, normalizes text once
at admission/query, and computes each candidate once rather than scoring again
inside sort comparisons. Match positions are converted by the search-text owner
to original path offsets, then published through the existing Quick Input span
contract. No renderer-side matcher, extra full workspace scan or score hash cache.

The file provider retains original `RuntimeResource` values, including domain.
Its catalog is already owned and ordered by the runtime source service. Equal
paths from different domains remain distinct selectable items. The displayed
path occurs once; kind/domain metadata is context, not another filename.
File queries match names/paths, not incidental kind/domain display strings.
Commands and reference/location choices retain their separate explicit policies.

Symbols are a later A06 provider slice. Neither a fuzzy string match nor a
matching filename proves semantic origin, call-target completeness or safe
graph restructuring.

## Validation and boundaries (2026-09-12)

The independent oracle compares scores **and positions** against the pinned
production recurrence, including changing matrix dimensions and patterns/paths
beyond 128 characters. Provider tests cover basename/directory priorities,
explicit and alternate-separator paths, repeated/reordered query terms, rejection
without stale highlights, original Unicode offsets, and two identical paths in
different sockets accepted as their exact original resources by the real control.

The original `a05a3e879` Studio fails the physical `tscr` file query. The current
real-machine smoke passes on software, WebGL2 and WebGPU: actual match glyph runs,
file acceptance, resource/domain identity, Back, query Undo and unchanged paused
machine/media. Its tiny-font/software screenshot was visually inspected. The
fixture uses real cart files as file-transport targets, not their Lua declarations,
line numbers or game behavior. Broader source-navigation and graph gates remain
separate from the scorer's oracle.

The final full Studio workflow and Pietious source/graph/Undo navigation gate
pass on all three renderers. Lua: 1569 tests, 1568 pass, one existing skip. IDE
typecheck, strict architecture audit (zero issues), core parity, indentation,
browser Studio build and diff check pass. The tests typecheck has the same 51
pre-existing diagnostics, compared by normalized diagnostic rather than count.

File ordering takes the upstream identity/name/path priorities, not its complete
MRU/`compareAnything` UI. Ties use match compactness, name/path and original catalog
position. Quoted-query syntax, typo permutations, accent transliteration and
symbol/container semantics are not claimed by this file policy.

### Targeted costs, not a whole-frame or low-end-hardware guarantee

`profile_file_query.ts` ran separately from builds/typechecks/browsers on the
development PC, Node 22.23.1: 10 warmups and 25 samples, 100 queries per sample.
It compares the existing literal provider and the new file provider over the same
independent catalog. They deliberately return different match sets; these numbers
are the cost of added fuzzy behavior, not a claim of equivalent-work speedup.

| Files | Picker admission (ms) | Broad `srct` query (ms) | `source` query (ms) | Absent query (ms) |
| ---: | ---: | ---: | ---: | ---: |
| 128 | 0.046 | 0.143 | 0.049 | 0.019 |
| 1024 | 0.112 | 1.170 | 0.385 | 0.158 |
| 8192 | 1.023 | 10.202 | 3.319 | 1.387 |

Admission includes the provider and control/visible-row preparation after typed
resource items already exist; it excludes source catalog construction. For
comparison, literal-provider admission was 0.072/0.121/1.105 ms; its `source`
query was 0.003/0.044/0.468 ms. Empty-query file projection was
0.0009/0.0030/0.0361 ms. At this viewport only ten rows are prepared. Warm control
update was about 0.013 microsecond, with no query. This is neither a render-frame
measurement nor a cold semantic-workspace, retained-heap/GC or SNES Mini proof.
No timeout, query/result cap, delayed typing handler or cart-specific exception
is used to obtain these results.
