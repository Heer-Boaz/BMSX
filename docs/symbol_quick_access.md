# Symbol Quick Access query policy (A06)

Lua symbol discovery, declaration identity, source-generation disposal and
navigation remain with their existing owners.

## Reference and boundary

VS Code at `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca` uses a different
[`fuzzyScore` recurrence](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/filters.ts#L683-L931)
for symbols than for files: prefix/case/boundary bonuses, gap penalties and
forward/backward alignment. Its `scoreFuzzy2` entry point permits a weak first
match and boosts a full match. A successful score can be zero or negative;
`undefined` is the no-match result, not a value to normalize or repair.

Both its [document](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.ts#L250-L358)
and [workspace](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/contrib/search/browser/symbolsQuickAccess.ts#L94-L183)
providers first try the complete whitespace-normalized query on a symbol. A
workspace query can then match its first word on the symbol and require the
remaining words in the container/file label. This is not a search over kind,
line number and all incidental display strings.

BMSX already displays the qualified `LuaSymbolEntry.path` as its symbol label.
That remains the symbol search text; no path splitting invents a new semantic
container. Document choices use that label. Workspace choices additionally have
the actual source path as their description and qualifier text. Equal scores
preserve the source catalog's ordering and distinct original declarations.

The scorer belongs to `ide/common`, not the compiler or a visual graph feature.
It retains matrix/position storage, uses the recurrence's minimum/maximum match
bounds and has no inherited 128-character truncation. Providers publish actual
display-field spans using the existing search-text and Quick Input owners. No
per-query semantic workspace search, debounce hiding query cost, generic cache
framework or second navigation/catalog layer is introduced.

## Execution and evidence (2026-09-12)

The retained scorer matches the production oracle's scores **and alignments**
across changing dimensions, punctuation, case, emoji separators and ordinary
accented text. Separate tests cover zero/negative scores, complete matches beyond
128 characters and missing suffixes that must not become truncated matches.
Case-fold expansion is tested at the original-text mapping boundary; the upstream
oracle uses original string lengths and is not an expansion-correctness oracle.

Symbol/provider tests cover qualified names, distinct same-name declarations,
workspace source-path terms, repeated/overlapping term ranges, absent results,
empty-query source ordering and retained match records. Range union belongs to
the shared Quick Input owner, not duplicate file/symbol feature loops. It runs
only for candidates whose complete query matched. Providers copy the resulting
field-local ranges directly into their retained projections.

The real `3c016ae3a` Studio fails the independent Lua fixture's `SHDW` query.
The new smoke passes on software, WebGL2 and WebGPU: physical document and
workspace symbol choices, displayed match runs, original source ranges, Back,
pointer acceptance, reference/multi-definition pickers, query versus document
Undo, source-generation invalidation and unchanged paused machine/media. The
tiny/software screenshot was visually inspected. Lua declarations are independent
fixtures; actual cart files are isolated file-API transport targets.

After the range-owner optimization, the full Studio workflow and Pietious
source/graph/Undo navigation gate pass on all three renderers. Lua: 1577 tests,
1576 pass, one existing skip. IDE typecheck, strict architecture (zero issues),
core parity, indentation, browser Studio build and diff check pass. The tests
typecheck retains the same 51 pre-existing diagnostics, compared by normalized
diagnostic content rather than count alone.

This does not add MRU, query typo permutations, quote/wildcard syntax or accent
transliteration. Nor does it close B04 semantic-origin completeness or authorize
cross-owner graph edits.

### Targeted query costs and shared-range check

`profile_symbol_query.ts` ran apart from builds/typechecks/browsers on the
development PC, Node 22.23.1: ten warmups and 25 samples of 20 queries. The typed
symbol catalog already exists; admission includes provider and control/visible
row preparation, not semantic discovery. Workspace results (milliseconds):

| Symbols | Admission | Broad `ae` | `spwn` | `spwn cntr` | Absent |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 128 | 0.024 | 0.107 | 0.020 | 0.045 | 0.008 |
| 1024 | 0.073 | 0.936 | 0.155 | 0.360 | 0.067 |
| 8192 | 0.657 | 7.692 | 1.326 | 3.043 | 0.630 |

Document-symbol admission was 0.025/0.041/0.460 ms; broad queries were
0.097/0.899/7.718 ms. Only ten rows are prepared in this viewport; warm control
update was about 0.013 microsecond and performs no query. Fuzzy queries are not
equivalent work to the old literal filter, so this is not a blanket speedup claim.

The shared range sweep was also checked against `3c016ae3a` with the same file
profile, using 20-query batches in both bundles. An intermediate implementation
unnecessarily swept singleton ranges: 8192-file `s` rose from 3.318 to 3.913 ms.
The range owner now returns singleton/empty unions directly, without a merge
pass. Final `s`: 3.229 ms; `source`: 3.221 versus 3.292 ms; broad `srct`: 10.674
versus 10.207 ms. That remaining broad-query difference is recorded, not called
zero regression or hidden behind a timeout/result cap. These measurements are
not total render-frame, retained-heap/GC, cold-workspace or SNES Mini proof.
