# Definition inputs, preview and tab presentation

## Scope and references

This document owns definition-occurrence matching, preview admission and bounded
tab presentation. Part composition, destination routing and shared close
admission belong to the [Studio workspace contract](studio_workspace_design.md).
Contribution-owned selection bookmarks belong to
[navigation history](workbench_navigation_history_design.md).

Production references at VS Code commit
`7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:

- [EditorGroupModel](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor/editorGroupModel.ts):
  input matching, one preview slot and promotion of an existing input.
- [MultiEditorTabsControl](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts):
  tab gestures, source descriptions, overflow scrolling and active-tab reveal
  belong to presentation, separately from group membership.
- [OutlineModelService](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/documentSymbols/browser/outlineModel.ts):
  source-derived structure is shared by model and generation rather than
  independently parsed for each view.

Studio inputs deliberately own view state and disposable view bindings. Distinct
views share their working copies, not the input object. This is not VS Code's
shared-input disposal model; the workspace contract describes that distinction.

## Definition identity and admission

An `EditorTextModel` owns authored text, dirty state and Undo/Redo for one admitted
`(contextId, path)`. A Behavior Lens input addresses one registration occurrence
within that source, not a guest id, label or list ordinal. Its tracked
registration-call range supplies source correspondence through edits.

- Opening another registration retains the first input, selection and viewport.
  Opening the same surviving occurrence in the destination group activates its
  existing input without resetting that presentation.
- A Behavior Lens input's lifetime id is neither a persistent asset id nor the
  resource/occurrence matching key. Closing and reopening creates another input.
- Renaming a definition or inserting source before its registration preserves
  its view. Deleting or replacing the complete registration clears its target;
  a later same-named insertion is not that occurrence.
- Titles name definitions. The group adds descriptions for duplicate titles;
  source context, logical path and registration line disambiguate them. Scene
  views retain their file-level scope rather than pretending each file is one
  declaration.
- Cross-registration Source or review links open the identified destination;
  they do not repurpose the departing input's identity.

## Shared generations and retained views

`BehaviorSourceDocuments` shares immutable source topology by canonical model and
the admitted semantic snapshot revision. Imported-source changes can invalidate
that generation without changing the anchor model's own text version.

`BehaviorSourceIndex` shares node, parent and occurrence maps for a document
generation. Its reference-counted acquisitions own the model subscriptions and
tracked ranges; each retained view acquires once and releases at disposal.
The weak-key document cache itself does not subscribe to model lifetimes.
An edit maps shared source ranges once, not once per displayed view.

Each input retains its own selection, viewport and asynchronous layout lifetime.
Edits and Undo publish through canonical working copies; they do not retarget
sibling definition inputs. Composite inputs retain all participating working
copies, including imported documents. Losing an import or a recognized syntax
node does not erase that input's existing Undo/Save participation.

Closing a view releases its projections and subscriptions after the shared close
owner admits retirement. It does not discard a working copy still presented by
another input. Contribution serializers own their plain view snapshots; live
input ids and worker/layout handles are not persistent source identities.

## Preview admission

Preview is an explicit opener option. A group replaces only its previous clean
preview after detaching that preview's pane. A kept input never becomes a
preview merely because a later opener requests preview; dirty inputs are kept.

Keep Open, a tab double-click, beginning an accepted tab drag, or making the
shared working copy dirty promotes its preview. This is not sticky-tab pinning.
Bitmap tabs identify previews explicitly rather than relying on another font.

## Bounded tab presentation

The tab strip occupies one clipped row, with a horizontal track when content
overflows. `Scrollbar` owns range, position, thumb geometry and minimal interval
reveal. Wheel input over tabs scrolls that axis, not the active document.
Active-tab reveal follows membership, activation or geometry changes; it does
not undo manual scrolling on stationary frames.

Font, available width and label changes invalidate the measured label cache.
Hidden tabs retain hit geometry but emit no glyphs; input disposal releases
their geometry entries. Unchanged frames neither remeasure labels nor rebuild
source generations for tab presentation.

`ScrollbarPointerControl` owns the thumb gesture without changing editor focus.
The tab-drag owner uses shared pointer capture: insertion feedback does not
mutate membership, and an admitted physical release commits the reorder.
Escape, lost admission, a blocking surface or an incompatible group change
cancels the gesture rather than completing a drop. Physical track/availability
changes revoke captured gestures; content refinement alone does not.

Tab and graph edge scrolling use the shared host-time primitive. Tabs introduce
neither an independent input loop nor another selection history. These are
specific work and lifetime bounds, not an end-to-end latency guarantee.
