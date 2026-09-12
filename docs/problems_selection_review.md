# Problems selection and paint ownership

2026-09-12; starting at `346a797e6`. This follows the adjacent UX review, not a
change to diagnostics, source restoration or Scene's form layout.

## Reference and live diagnosis, before the patch

- [VS Code ListWidget styles](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/list/listWidget.ts#L915-L1007) distinguish active selection, inactive selection and focus outlines. An inactive selection is not inherently a full-strength focus rectangle.
- [List theme roles](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/theme/common/colors/listColors.ts#L35-L49) supply background/foreground separately; inactive focus outlines are optional, not a substitute for a selection background.
- [List containment](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/list/list.css#L6-L41) keeps rows within their list surface. BMSX's existing retained clip scopes provide that ownership without a DOM layer or another renderer.

The Scene/Problems capture's horizontal lines are emitted by the Problems
renderer for an **inactive selected diagnostic**. Its rectangle shares the
row's exact glyph top/bottom; they are not escaped Scene property separators.
The renderer also has no panel/content clip: a wrapped last row is submitted
past its viewport. Later chrome painting can hide that spill but does not own
its containment.

## Contract

- Keep the selected diagnostic while focus moves back to source/Scene. Do not
  clear selection, change row heights or offset text to hide the rectangle.
- Shared theme selection roles distinguish inactive background/foreground from
  active selection. Problems uses those roles; severity remains an independent
  icon colour. No per-frame palette/style objects.
- Problems owns the outer panel clip and its content clip. Partial wrapped
  rows are cropped without repositioning glyphs; pop restores the caller's
  clip. Empty content obeys the same ownership.
- Preserve row layout, scroll/reveal and diagnostics caches. Header and content
  padding consume pointer input without hovering or activating clipped rows;
  row hit testing uses the same content interval as painting.
  This is not a variable-height list migration or a renderer refactor. No
  machine/C++ representation or hot-path datapath changes are needed.

Independent tests must distinguish focused/unfocused/none, both themes/fonts,
glyph-position stability, wrapped/partial rows and clip lifetime. Inspect actual
Studio captures in software, WebGL2 and WebGPU after the source patch; do not
merely replace the old screenshot expectation.

## Implementation and independent regressions

`ThemeDefinition.text` now supplies inactive selection background/foreground
roles beside its existing active selection roles. The Problems painter selects
the proper pair; it no longer borrows the completion popup's selected text
colour. Dark and light themes use existing palette tokens, not per-frame style
objects or a new palette ABI. Existing focus outlines in other controls are not
renamed or globally removed by this change.

The painter scopes panel and content clips through `OverlayRenderer`. Its empty
state no longer exits before the common clip-pop/bottom-border path. Pointer
dispatch uses that same content interval: header/padding still focus the panel,
but neither retain row hover nor activate a clipped diagnostic.

Eight independent tests cover both fonts/themes, active/inactive/no selection,
unchanged glyph geometry and measured row layouts, wrapped-row cropping, empty
content, nested caller clips and header/padding pointer routing. A 100-frame
warm probe retains both command buffers, clip/geometry submissions, measured
line arrays and GPU quad/batch storage. This is not a claim that every existing
text-rendering call is allocation-free. Before the patch, five of the original
six paint tests fail; the separate pointer regression also fails before its
owner change.

The actual Scene workflow additionally clicks the Problems bottom padding,
checks that no source opens or changes, and returns to Scene with the same
inactive diagnostic selection. No cart-specific line numbers or diagnostics are
used as its oracle.

## Validation and measured cost

Artifacts: `/tmp/bmsx-problems-selection/`. All eight new tests and the full
Lua suite pass: 1,649 passed, one existing skip, no failures. Toolchain and IDE
TypeScript pass; tests TypeScript retains exactly the 51 preceding complete
diagnostic blocks (source locations normalized), not a clean typecheck. Strict
architecture boundaries, core parity, indentation and diff-check pass.

A fresh Studio build passes the actual Studio workflows and Pietious navigation
on software, WebGL2 and WebGPU. Scene/Problems captures were inspected: only the
selected diagnostic's twelve-pixel-high row changes from the preceding capture
on each backend; no other pane geometry changes. All three navigation captures
remain byte-identical. This does not close the separate reported graph zoom or
code string-colouring issues.

Three alternating isolated process pairs against `a1c267067`, Node 22.23.1,
Core Ultra 7 265KF/WSL. No BMSX test/build/browser job ran alongside the profiles.
`profile_problems_panel.ts` measures retained paint submission, separately paint
plus the actual GPU quad stream, in a 256×212 host surface with a fixed 100-pixel
panel. It does not measure GPU delivery, software raster, browser frames or
weaker target hardware.

| Font / diagnostic count | Paint before → after | Paint + quads before → after |
| --- | ---: | ---: |
| Tiny / 16 | 9.050 → 9.098 µs | 18.761 → 18.858 µs |
| Tiny / 1,024 | 9.112 → 9.028 µs | 18.659 → 17.877 µs |
| MSX / 16 | 7.054 → 6.577 µs | 13.905 → 13.174 µs |
| MSX / 1,024 | 7.006 → 6.805 µs | 13.807 → 14.016 µs |

Empty-panel paint remains about 0.6 µs. Work remains tied to visible rows, not
the full diagnostic list. Nonempty panels add four retained clip commands;
empty panels also gain the previously skipped bottom border. The quad stream
records four batches instead of one for the separate clips. That containment
has a real submission cost even where process timing is within noise; no
performance improvement or globally allocation-free rendering is claimed.
