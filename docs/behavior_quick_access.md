# Behavior-level Quick Access

## Owner contract before implementation

`Behavior Lens: Open` chooses an authored FSM, BT or ActionEffect registration,
never a Lua file. Invoking the command always offers that choice, including
from code or an existing lens. A resource remains the text-model/tab owner;
accepting a result selects and reveals that exact definition in the retained
lens. Multiple registrations in one file and duplicate ids are separate picks.

The production reference is VS Code's [workspace symbol provider](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/workbench/contrib/search/browser/symbolsQuickAccess.ts#L125-L208):
the primary label is the symbol, the container/source path is secondary, and
acceptance carries the selected symbol's location rather than choosing a file
and guessing the first declaration. Its [document symbol picker](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.ts#L145-L185)
retains one symbol request through filtering. BMSX reuses its synchronous
Quick Input owner; it does not copy VS Code's extension-host or asynchronous
provider machinery.

## Typed entry points and command categories

The ActionEffect source projection already exists in `action_effect.ts`: event,
handler, trigger gate, cooldown, period and tag/state constraints. It consumes
the same canonical Lua as the FSM and BT projections. A new opening command
does not justify another editor, authoring format, source index or runtime hook.

`Behavior Lens: Open ActionEffect`, `Open State Machine (FSM)` and
`Open Behavior Tree (BT)` constrain the same registration picker by the
producer's `BehaviorKind`. The unconstrained `Open` remains available. Kind is
not a query prefix or a filename test: typing, clearing the query, duplicate ids
and unresolved authored ids cannot change the requested kind. Only accepted
registrations receive display items; filtering retains those items and does
not parse source or rebuild topology. Selection still reveals the exact
registration in the resource-owned lens, including multiple effects per file.
The lens remains a source view, not a claim of live runtime visualization.

Palette category belongs to command presentation, not menu placement or the
dispatch module. Opening a tool groups with its actions under `Behavior Lens`,
`Scene Editor` or `Scenario Lab`. `View` retains workbench visibility and wrap;
resource filtering belongs to `File`, source finding to `Search`, rename to
`Edit`, and theme selection to `Preferences`. Existing `Go`, `Run` and `Debug`
commands keep their navigation/execution meaning. No nested palette, command
alias, second dispatch map or compatibility category is introduced.

The existing short title is shared by compact menus and title action bars;
the palette uses the full category-qualified title. Thus `Scene Editor: Open`
is still `Scene Editor` in the View menu, not an ambiguous `Open`. Presentation
selection remains in the command catalog; state-dependent Pause/Resume and
Show/Hide labels stay identical across surfaces.

Production references, read before this change:

- VS Code [Action2 metadata and registration](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/platform/actions/common/actions.ts#L669-L757)
  separates category, menu placement and command execution.
- Its [MenuItemAction label selection](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/platform/actions/common/actions.ts#L584-L591)
  lets compact surfaces request an action's short title; the
  [palette](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts#L227-L267)
  composes category and full title.
- The [Testing Show Output action](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/workbench/contrib/testing/browser/testExplorerActions.ts#L872-L903)
  belongs to its functional category even though it opens a view.
- [Symbol picks](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.ts#L334-L395)
  retain the provider's symbol kind rather than rediscovering kind from labels.

BMSX adopts those ownership choices, not VS Code's dynamic registrations,
localization alternatives, extension-host services or asynchronous provider
machinery. The built-in catalog and synchronous source contribution already
own this work; a new generic menu or inspector layer would duplicate them.

## Representation and lifetime

- The behavior contribution owns shallow registration recognition: retained
  call syntax, behavior kind, authored id spelling, resolved literal/const id
  when available, source location and occurrence-qualified definition row key.
  The lens topology and registration index consume that same producer. Keys
  are source-view identity, not guest ids or another authored behavior schema.
- A computed id stays visible by its authored expression; an incomplete
  registration stays unresolved. Neither is assigned a fabricated runtime id.
  Runtime trace-to-source lookup indexes only statically resolved ids.
- `BehaviorRegistrationIndex` retains shallow registrations by semantic file
  identity and resource domain. Listing and runtime-id lookup share it. Dirty
  text comes from the resource-owned model, not a code-tab requirement. Queries
  synchronize source generations on invocation, not on frames or keystrokes.
- Picker rows carry the actual registration. Labels identify behavior kind
  and name and determine their initial ordering; the path is secondary and
  domain/line disambiguate duplicate names. Equal labels retain source order.
  Choosing one definition never materializes all other documents' topology.
- Acceptance uses the registration's occurrence-qualified row key, not a name
  search or an initializer range that two registrations might share. The
  existing lens navigation/layout owners reveal that root and Source opens its
  actual syntax. Escape returns the invoking focus without changing selection.
- Scene admission and generic Lua-symbol widgets are not changed by this
  slice. Machine, cartlib, compiler semantics and C++ require no edits.

## Required evidence

Prove two FSMs in the same file, different kinds with the same id, duplicate
registrations sharing an initializer, unresolved ids and unsaved edits. The
physical Studio route must open from code and non-code views, choose a specific
behavior, reach its exact source, retain the shared model, preserve cancellation
focus and leave the paused machine unchanged on all three browser backends.

## Landed evidence

- The shallow-index test distinguishes two FSM occurrences sharing the same id
  and initializer, a BT with that id, the same id in another domain, a computed
  id and an incomplete registration. Index keys equal the lens's definition
  keys. Unrelated file changes retain registration objects; source Undo and a
  replacement semantic project both preserve the correct dirty-source view.
- `studio_behavior_picker.ts` adds four temporary FSM registrations through
  the actual Nemesis text model. Physical Palette/keyboard/pointer operations
  choose the second FSM and the second duplicate, reveal the exact root, open
  its source reference, cancel back to the same focus and remove the entries
  through ordinary Undo. The machine's cycle position and media remain intact.
- The complete Studio workflow passes on software, WebGL2 and WebGPU,
  including the earlier Moon `79:6` navigation/parameter-help regression,
  source Save/Hot Resume/Reboot and Scenario Lab flows. Native 384×288 picker
  output was inspected; the final screenshots match across the three backends.
- The real headless Behavior Lens test passes 61 assertions, including Moon
  BT occurrences, nested/concurrent player FSM states and ActionEffect source
  navigation through explicit behavior choices.
- Lua: 968 passed, one existing skip. ROM-packer: 122 passed. IDE typecheck,
  strict architecture audit (zero issues), core-parity audit, indentation and
  diff checks pass. Tests-project typechecking retains its 52 existing
  diagnostics, without additions. Both debug Studio products were rebuilt.

Artifacts: `/tmp/bmsx-behavior-picker/`. These checks establish the described
source-selection flows, not arbitrary runtime behavior-id evaluation or a new
behavior-authoring system.

## Landed evidence: command domains and typed choices

- The kind-choice index test uses FSM, BT and multiple ActionEffect registrations
  in one file, with intentionally misleading shared names, duplicate effects
  and a computed id. Choices preserve the producer objects; clearing the
  query cannot remove the kind constraint. Removing definitions and Undo both
  update the same source-generation index, without an empty-result fallback.
- Command-presentation tests prove that View-menu placement does not determine
  palette category, compact menu labels still distinguish the three tools,
  title actions keep `Source`, and state-dependent titles keep Pause/Resume
  and Show/Hide behavior on both surfaces.
- `studio_behavior_kinds.ts` physically opens the real Nemesis `fire_salvo`
  from Scenario Lab, selects its period field, opens the exact source, edits
  the canonical Lua, reopens the same retained lens, and undoes through ordinary
  code-editor input. It also exercises typed FSM/BT choices, empty results,
  cancellation focus and an unchanged paused machine/media. The command-palette
  workflow asserts the real context-dependent category entries. Existing
  View-menu, Moon timeline, source Save/Hot Resume/Reboot and scenario tests
  still execute through the ordinary owners.
- The complete physical Studio suite passes on software, WebGL2 and WebGPU.
  The ActionEffect view was inspected at the actual tiny-font resolution;
  screenshots are byte-identical across the three backends. Their lower status
  area retains the earlier deliberately induced scenario-preparation error,
  not a new view or runtime fault.
- Lua: 971 passed, one existing skip. ROM-packer: 122 passed. Actual headless
  lens: 61 assertions passed. IDE typecheck, strict architecture audit (zero
  issues), core-parity, indentation and diff checks pass. The tests-project
  typecheck retains 52 existing diagnostics and adds none. Both debug Studio
  products were rebuilt. Artifacts: `/tmp/bmsx-command-domains/`.

This proves source-view discovery, categorization and navigation. It does not
claim an editable ActionEffect graph or a new live cooldown/trigger monitor.
