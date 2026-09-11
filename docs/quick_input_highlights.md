# Quick Input match presentation (A06)

Status: implemented and validated (2026-09-11). This is match presentation, not a new
semantic query cache, fuzzy-file policy or Peek editor.

## Reference and ownership

VS Code at `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca` separates
[matching](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/filters.ts)
from [highlighted labels](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/highlightedlabel/highlightedLabel.ts).
The matcher publishes source-text spans. The label renders normal and matched
runs; it does not search the query again. Its DOM/string construction is not the
BMSX bitmap-overlay hot path.

- Providers publish match spans in the original display fields. Ranking and
  selection remain provider-owned. Command word matches retain the already
  adopted adjacent-first recurrence, including separator equivalence; an
  equivalent but different separator is not a highlighted character.
- A projection owns retained span storage; each retained match names its span
  interval. Sorting rows never turns a display position into an admission id.
  This uses the existing `ScratchBuffer`, not one growing collection per field
  per catalog item or a new pool framework.
- Literal terms remain ranges, not expanded character lists. Matching records
  token starts; only a fully admitted result orders/merges those ranges. Word
  matching restores positions from its existing matrix. Both publish field-local
  spans directly through the shared display-boundary writer.
- Case-folded search text owns conversion back to original UTF-16 offsets.
  The renderer never treats normalized search offsets as display offsets.
- The shared label owns truncation and visible text-run geometry. Ellipsis is
  not source text and cannot acquire a source match. Query changes invalidate
  highlight geometry; font/width changes invalidate measurement. Idle frames
  reuse both and submit original string spans through the existing overlay API.
- Literal metadata matches are marked in that metadata. Exact command-id
  aliases are not falsely marked in an unrelated label. File/symbol fuzzy
  matching remains a subsequent provider-policy change.

## Gates

Independent tests compare word-match positions with the pinned production
oracle, exercise overlapping/repeated literal terms and case-fold expansion,
and verify clipping/truncation, fonts, selected/unselected colors and query
invalidation. A provider can publish highlights without a visible query
substring: the control must consume them unchanged, with no second matching
pass. Real Studio routes and screenshots cover command and source choices on
software, WebGL2 and WebGPU. Catalog, query, visible preparation and idle costs
are measured separately from cold-workspace and whole-host evidence.

## Implementation and evidence

Six independent tests cover the display contract and normalized/source offset
mapping. The existing word-matching oracle now compares exact positions as well
as admission, including repeated separators and long inputs. The actual overlay
command tests consume original strings and font objects, with selected/unselected
match colors in both themes. Changing only match spans does not remeasure text;
cached runs are reused, and a nonliteral test provider is not reinterpreted by
the control.

The physical Studio probe opens Command Palette, types `hr`, changes the query,
uses Undo and closes it without advancing the paused machine. It observes real
overlay submissions without replacing painting. On `1eef4a5bc` the same probe
fails because `H` and `R` are not separately marked in `Run: Hot Resume`; it does
not depend on a newly added provider property to manufacture that failure.
The source-choice fixture also checks real symbol and reference match runs,
ordinary source navigation, Back and Undo.

The software and WebGL2 tiny-font screenshots were inspected; both show only
the query's initials in the match color, with the remaining selected label in
the selected foreground. The smoke passes on software, WebGL2 and WebGPU and
exercises both IDE fonts. After the retained-range correction, the full Studio
workflows and Pietious source/graph/Undo gate pass again on all three renderers.
Lua: 1561 tests, 1560 pass, one existing skip. IDE typecheck, strict architecture
(zero issues), core parity, indentation and browserproductbuild pass. The tests
typecheck retains its 51 existing diagnostics, with no added/excluded error.
`git diff --check` passes.

### Targeted cost comparison

Three interleaved process pairs compare identical Node bundles, substituting the
IDE owners from `1eef4a5bc` for the baseline. Bundle construction and all browser,
build and typecheck work finish before timing. Each median has ten warmups and
25 samples. The source profiler resolves its semantic query before timing;
these are not cold-workspace numbers.

| Work | Before | With match spans |
| --- | --- | --- |
| Admit/layout 128 generic choices | 0.053–0.069 ms | 0.077–0.083 ms |
| Admit/layout 1024 generic choices | 0.081–0.119 ms | 0.107–0.123 ms |
| Admit/layout 8192 generic choices | 0.967–1.096 ms | 0.799–0.858 ms |
| Project/admit/layout 1025 source choices | 0.196–0.242 ms | 0.204–0.292 ms |
| Rank all 1025 source matches | 155–161 us | 162–167 us |
| Path query among 1025 source choices | 13.1–13.7 us | 13.1–13.2 us |
| Absent term among 1025 source choices | 30.1–31.3 us | 29.4–30.4 us |
| `hr` among 62 command labels | 21.0–21.6 us | 22.4–22.6 us |

Only ten rows are prepared in the generic viewport. Warm updates remain
0.010–0.015 us/frame in these bundles. The small-catalog admission increase
includes visible glyph-advance/run storage; match presentation is not claimed
to be free or an overall speedup. Nor are these full overlay/backend draw, GC,
whole-host or SNES-mini measurements.

An intermediate implementation unnecessarily expanded literal ranges into
individual characters and sorted them back together. Its all-matching source
query cost about 352 us and its absent-query scratch resets added work even for
rejected candidates. That representation was removed before landing: literal
matching retains token starts, admits the result, then orders/merges its actual
ranges. The word matcher already produces positions, so it restores those from
the retained production recurrence. Neither path redoes matching in the UI.
