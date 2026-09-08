# Behavior-level Quick Access

## Owner contract before implementation

`View: Behavior Lens` chooses an authored FSM, BT or ActionEffect registration,
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
