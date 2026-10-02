# Studio module authoring

## Workflows

### ActionEffects and actionstrings

- **ActionEffect: New Effect** creates ordinary Lua source; the cart imports it
  and grants the registered effect through its existing component factory.
- **Behavior Lens: Open ActionEffect** opens written definitions, including
  imported tables. Add/Edit/Remove operate on the original source model with
  shared Undo, Redo and Save. Multiline callbacks remain source-editor work.
- **Test Effect** selects an actual granted instance and reveals its Actor Lab
  node, even when its ancestors were collapsed or its topology was unchanged.
  Trigger, payload, activation and cooldown use the actual component. **Live**
  distinguishes an instance's retained definition from the authored definition.
- **Input: Open ActionEffect Bindings** exposes the written input component
  program. Select an `on` actionstring and **Input Test** prefills its resolved
  string; **Input: Test Actionstring** also accepts a separate expression.
- The experiment asks for a player, `clock.frame` or `clock.gameplay`, and steps
  with `key`, optional `gamepad`, `down`, `expect`, `max_ticks` and optional
  `after_ticks`. Optional `verify(t, index, match)` asserts cart state/effects.
  It creates a normal `tests/*_assert.lua` suite and starts Scenario Lab's isolated
  machine. That suite can be edited, debugged and rerun normally. `input.has_player`
  observes real initialization; the test does not add/replace player mappings.

### Progression and input programs

- **Progression: New Program** creates a Lua definition containing the compiled
  program and filters. Cart code imports and mounts it on a cart-owned context.
- **Progression: Open Program** and **Input: Open ActionEffect Bindings** recognize
  actual cartlib producer imports/reexports, not same-named user functions.
  Add/Edit/Remove use syntax ranges and shared working copies for rules, writes,
  conditions, handlers, bindings and command maps. Dynamic/computed/mutated
  definitions are not reconstructed as editable defaults; Source stays available.
- Nested filter lists add real `{ key, equals }` conditions. Input choices include
  custom patterns, mode gates and ordered combos with actual `steps`; keyboard
  sequence definitions expose their own fields. Placeholders are authored examples,
  not substitutes for cart-owned tags, handlers, state paths or player mappings.
  Reserved field names such as `not` use the shared Lua field writer.
- A component record without a uniquely written `program` is explicitly unresolved,
  not presented as an empty editable program. Later duplicate named fields win,
  as in Lua; the original source is retained. Structured row paths distinguish
  arbitrary string keys from anonymous list entries. Multiline values use the
  shared source preview and are edited in Source rather than overflowing a cell.
- **Source/Live** selects an actual mounted progression context or input component,
  not an inferred association with the open source. Progression shows values,
  state revision, event rules and once-only receipts. Input shows its compiled
  program, latches, custom matches and queued event/command counts.
- **Play/Pause** and the live view's frame advance/rewind controls use the existing
  IDE execution/replay owner without switching away from the inspected module.
  The header shows its actual Live/Replay/Paused/Seeking state. Run-menu frame
  navigation and the Studio frame tools also work. Restored
  heaps reacquire values; absent contexts retire selection rather than retargeting
  a later allocation. Heap replacement requires choosing a new instance.
- Editing Lua does not replace living contexts/components automatically.
  Save/Hot Resume publishes source through existing owners; runtime rebinding or
  reconstruction remains an explicit cart policy.

### Audio Event Maps

- **Audio Event Map: Open** and normal AEM resource opening use the structured
  editor. **Source** opens the same working copy as YAML/JSON text.
- Add events through the actual cartridge audio-asset picker; add/remove rules,
  actions and properties using the cooker's shared AEM vocabulary. Inline Edit
  accepts a YAML/JSON scalar expression. Multiline values stay in Source.
- The official `yaml` parser retains CST tokens. Targeted edits preserve untouched
  comments, quoting, collection style and newlines; only new fragments are emitted.
  JSON fragments remain JSON. Source errors are shown instead of normalized.
- Save uses the existing AEM validation, asset installation and `reload_from_rom`
  path. **Audition** requires the saved source to be applied and uses an actual
  actor event/payload through the World rendezvous. It is not a browser audio player
  or a second audio simulation.
- Persistence and runtime application are separate outcomes. In the live audit,
  applying from an O0 artifact to the existing O3 live compiler could not relocate
  its suspended continuation. The saved source remained pending; no automatic
  reboot, rollback or hidden retry was added. A normal O3 build and subsequent
  AEM edits applied successfully. General cross-optimization Hot Resume remains
  outside this editor change.

## Ownership and retained work

Contributions are separated into source projection, schema/templates, controller,
input, pane and serialization. `ide/language/lua/source_reader.ts` owns written
Lua resolution; `ide/language/yaml/structured_edits.ts` owns structured text edits.
The shared property-cell control owns draft/focus/pointer lifetime, not syntax,
asset state or source history. Views use existing command, menu, tree and model
services. Source-backed selection/collapse restoration requires matching source
provenance; runtime identities are not persisted as editor-session data.
Previously presented provider documents remain part of a program view's working
copies when an import changes or the producer becomes incomplete. Dirty indication,
Save and Undo therefore retain their actual document owners. Session deserialization
reattaches those documents before projecting current syntax, including providers
that are no longer reachable from that syntax.

Source projection runs once per model/semantic generation. Runtime projection
is invalidation-driven and retains rows across ordinary execution. Progression
values use the owning state revision; once-only receipts cannot rely on it.
Typed rule-ID indexes avoid repeated rule/receipt cross-scans. Input scalar cells
skip unchanged formatting; mutable tables use bounded previews. No guest tick hook,
heap scan, cartlib debug registry, or per-frame source reconstruction is added.

## Production references

- [VS Code debugger variables](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/variablesView.ts):
  stable tree identity, separately retained view state, contextual value editing.
- [VS Code composite editor serialization](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/common/editor/sideBySideEditorInput.ts):
  restore constituent document inputs before constructing the composite view.
- [Unity Input Debugger](https://github.com/Unity-Technologies/InputSystem/blob/develop/Packages/com.unity.inputsystem/InputSystem/Editor/Debugger/InputDebuggerWindow.cs):
  input topology and activity are separate refresh responsibilities.
- [Godot animation editor](https://github.com/godotengine/godot/blob/master/editor/animation/animation_player_editor_plugin.cpp)
  and [audio buses editor](https://github.com/godotengine/godot/blob/master/editor/audio/editor_audio_buses.cpp):
  actual playback owners and document-owned Undo rather than a second simulation.
- [Red Hat YAML language server](https://github.com/redhat-developer/yaml-language-server/blob/main/src/languageservice/parser/yamlParser07.ts)
  and [official YAML document API](https://eemeli.org/yaml/#parsing-documents):
  parser/CST-owned source boundaries rather than re-emitting the complete asset.

## Acceptance evidence

Actual Studio keyboard/pointer operations authored a progression rule and an input
binding, added/edited an AEM event, and exercised shared Undo/Redo/Save. Public Studio
tools approved source wiring, built/opened the saved cartridge and exercised actual
frame/history navigation; these steps are not claimed as UI-only authoring.
The isolated actionstring scenario matched real KeyX press/release and asserted
that gameplay binding had changed cart progression. AEM Audition reached actual
audio completion and routed its `on_finished` event into progression. This proves
the playback/event path, not perceived sound quality. The live progression view
showed `nil`/pending at frame 65, `true`/done at frame 85, then `nil`/pending after
rewinding twenty frames, and `true`/done after replaying those same recorded frames.
Visible Play/Pause subsequently advanced the machine and paused it again. The
input component's frame buttons stepped 91 to 90 and back to 91 while retaining
the live inspector; public runtime status confirmed both physical frame positions.
The granted-effect UI returned `true` from the actual Trigger operation. A browser
reload with a restored Actor Lab tab succeeded after fixing premature CPU-domain
access in its admission callback. Unit tests separately cover
source preservation, actual compiled guest readback/lifetimes and unchanged-read
work. Typechecks and audits are structural gates, not substitutes for live evidence.

The follow-up source-boundary audit exercised an authored two-press combo in the
isolated Scenario Lab machine: KeyX press/release/press/release matched at ticks
3/4/6/7, and the combo's real emitted event changed progression on the second press.
The first press emitted a different event, so an ActionEffect's immediate event
could not masquerade as combo completion. A separate UI exercise edited an imported
binding's priority without saving, removed the producer's `program` field through
an approved source review, and saved the pending provider from the unresolved
program view. Repeating that exercise across browser reload retained the dirty
indicator and saved the exact pending priority after recovery. These are ordinary
UI/model workflows, not assertions about rendered strings. Filter insertion is
also exercised through Add on the filter's condition list, followed by shared
Undo/Save, and compiled and executed against real cartlib in O0 and O3 guest machines.

### Requested feature audit

| Request | Delivered path | Observed result |
| --- | --- | --- |
| Build and test ActionEffects | New Effect, Behavior Lens Add/Edit/Remove, Test Effect | Actual granted instance accepted Trigger; shared source Undo/Redo/Save exercised |
| Enter/read/test actionstrings | Input Bindings selection or Test Actionstring; Scenario Lab | Actual player mappings, press/release and ordered combo verified in isolated runs |
| Edit and real-time debug progression | New/Open Program, Source/Live, Play/Pause, frame controls | Actual state and once-only receipts changed, rewound and replayed without leaving the inspector |
| Missing AEM authoring | Audio Event Map structured editor, asset choices, Save, Audition | Real audio completion emitted `on_finished` into progression |

General O0-to-O3 suspended-continuation relocation remains a separate Hot Resume
limitation, as described above. These editors neither conceal it nor reboot the
machine implicitly. They also do not replace living program instances on Save;
that lifecycle remains owned by the cart.
