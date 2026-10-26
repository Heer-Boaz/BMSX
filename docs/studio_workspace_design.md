# Studio main workspace and document editors

## Product boundary

Studio has a persistent project work area, with document editors that can be
used without replacing that work area. Home is welcome/navigation content,
not the main window's identity or its lifetime owner. This is a target contract;
the existing single active editor group does not implement it.

The target supports multiple independently living editor parts and Source
controls. It is not restricted to the number of windows in the first delivery.
Project selection, target-free startup, docking and native host windows have
their own admission/presentation requirements; they are not implemented merely
by arranging canvas windows.

```text
Studio frontend — one attached workspace
├─ Main editor part — permanent project work area
│  ├─ Project content browser
│  ├─ Main editor group(s), authored subjects and selections
│  └─ Contextual hierarchy/details and explicit run controls
├─ Document-editor parts — modeless editor windows
│  └─ Group(s) of Source / FSM / BT / effects / animation / audio / other tabs
└─ Owned inspectors, popups and dialogs
```

The main area remains a working editor while document windows are open. Opening
or closing a BT must leave the main tool, its subject and its selection intact.
At small sizes the foreground editor may cover the main area; covering a view
does not destroy it. Home can be closed without closing the project work area.

The existing Scene tool is a source-backed outline/property editor. Its Lua
resource may contain several scene declarations. Neither the running game frame
nor a runtime World is an authored level viewport. A visual level editor needs
its own source-backed scene, asset-resolution and rendering contract before
it can be advertised as such.

At attachment, restore the saved main subject and view through their source
owners. Without a selected main subject, show Home and working project-content
navigation. Choosing a Scene opens its document in the main part; ordinary
asset navigation opens a document part. No first-file/first-declaration guess or
running-frame substitution supplies a main scene. Opening Home later is an
ordinary navigation action; the main part itself remains the permanent owner.
An authored subject that becomes unavailable is still that subject, not an
invitation to substitute Home or another declaration.

## Production references

- Epic distinguishes the permanent Level Editor, project Content Browser and
  specialized editors in its [editor interface](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-editor-interface).
  The transferable decision is the main/project versus document-tool boundary,
  not the assumption that BMSX already has Unreal's level model or viewport.
- VS Code's [editor parts](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorParts.ts)
  distinguish the main part from auxiliary parts. An
  [auxiliary part](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/auxiliaryEditorPart.ts#L178-L190)
  has a concrete editor container and scoped editor operations, not another
  working-copy store. BMSX adopts that ownership separation without copying
  dependency-injection containers or creating an operating-system window.

Window presentation and physical input follow the existing
[surface/window contract](workbench_windowing_design.md). Document/input
identity follows [definition inputs](workbench_definition_inputs_design.md);
selection bookmarks follow [navigation history](workbench_navigation_history_design.md).

## Owners and representations

| Owner | Retained state and responsibility |
| --- | --- |
| Attached workspace | Source/file authority, admitted resource catalog, working copies, semantic caches, Save, recovery and navigation. Execution attachments consume these owners; they do not supply authoring identity. |
| Main editor part | Project navigation, main groups and their authored subjects/views. Its lifetime is the workspace attachment, not the active document tab. |
| Editor part | Window/container, group layout, active group, client bounds and local focus/capture scope. A part is a concrete composition, not a facade over global active state. |
| Editor group | Ordered inputs, active/preview input, pane instances, tab chrome, group focus/capture scope and outstanding editor-opening lifetime. Each concurrently visible group has its own panes and controls. |
| Editor input/view | One presentation identity, selection, scroll and source-correspondence bookmarks. Another part gets another view/input when an additional view is explicitly requested. |
| Working copy | Authored text, dirty state, versions and Undo/Redo for one admitted resource identity. Views of that same identity share this owner. |
| Source control | Its text layout, native caret, selection gestures, completion and Find/Rename interaction. Font/theme and project semantic results remain shared at their existing owners. |
| Surface/window owner | Paint order, placement, clipping, chrome and input admission. It does not own the document or choose a physical execution target. |
| Workbench navigation | One Back/Forward history of concrete destinations and contribution-owned selections, including the destination part. Creating or disposing a part does not reset unrelated history. |

All parts in a frontend share its workspace services. A group is not a window:
several groups can be arranged within a part, and the layout owner supplies their
bounds. Reusing a pane within one group does not make that pane reusable by two
simultaneously visible groups.

An auxiliary editor is not another `RuntimeIdeState`, `StudioWorkbench`, native
Studio session or source authority. Closing it retires its controls and views,
not those shared owners.
Source-access and review capabilities belong to the attachment/session. Creating
or focusing another editor window cannot grant permission to edit or Save.

Source layout is separated by responsibility, rather than copying the entire
current `CodeLayout` into every window. Canonical source/semantic/highlight data
and font-generation measurements can be shared by their producer keys. Wrapping,
visual-row/viewport projection, hit testing and interaction belong to the actual
control. An unchanged second view reuses source/index generations; stationary
frames do not parse, rebuild highlights or remeasure unchanged source per view.
Injected completion/ghost text and other view-specific projections stay with
their control; they are neither canonical source nor another view's shared
highlight/measurement result.

## Identity and admission

The attachment/recovery namespace, authored location, resource context, editor
view and physical target are distinct identities:

- The attached workspace's namespace is selected at attachment, not by the last
  focused tab or the CPU's current cartridge socket.
- Resource identity is a workspace-admitted **source context plus logical
  resource path**. A source context is an admitted source/module/asset-resolution
  namespace: entry/source sets, dependency bindings and generated symbols. Its
  stable admission identity belongs to workspace attachment metadata, not to an
  executing socket, build output, source-kind label or filesystem deduplication.
  Identical configuration values can still describe distinct admitted contexts.
  `RuntimeResource.location` describes project/shared/generated provenance.
  Content browsers consume that producer-owned provenance; folder names and
  socket numbers do not establish project membership.
- A shared provenance path can intentionally have distinct BIOS/cartridge
  resource contexts and working copies. This design shares models for the
  **same admitted resource identity**; it does not merge them by filesystem path.
  Restorable context identity comes from its owning workspace/project
  admission/configuration, rather than a process handle or the installed slot.
  Text edits, debug/optimized builds and socket relocation change generations or
  execution attachments, not that identity. Existing tooling does not provide a
  universal configuration key; publishing/persisting this identity is a central
  admission-producer requirement, not a new mandatory project manifest.
- FSM/BT/effect views identify the canonical model, declaration occurrence and
  kind. Semantic names are labels, not substitutes for occurrence identity.
  The main Scene view likewise retains its actual source document and selected
  scene/member occurrence. Deletion retires that subject instead of selecting
  a namesake or the next row.
- A runtime subject belongs to its explicit target/session and current
  heap/media/history lifetime. Domain numbers and object hashes can repeat in
  the authoring machine, Play and test targets. They cannot identify an authored
  asset or be restored as if they did.

The current catalog/model implementation uses `(domain, path)`, with the three
installed system/cartridge domains. That is not yet the independent source
context representation above. The catalog/resource/model owners must produce
and consume logical source contexts before arbitrary or uninstalled projects
are admitted. This is a central identity change, not a renamed slot id or an
alias at Home. Existing distinct resource contexts remain distinct during that
change, even when their provenance paths match.

An execution attachment maps its installed domains to admitted source contexts
through actual image/build provenance, including the exact installed source
generation. Context correspondence does not certify that today's unsaved text
is executing. Module and asset resolution consume their context's admitted
bindings instead of selecting packages through a physical socket or recreating
local-domain/BIOS lookup heuristics in features. Authoring owners can exist
without that attachment. Existing boot, debugger, Play and test owners retain
physical-target and installed-source lifetimes; they are not duplicated inside
editor parts.

Save locations and capabilities are producer-owned data separate from model
identity. Distinct contexts writing the same file retain distinct dirty buffers
and the existing expected-baseline conflict boundary; Save does not merge them
or mark another buffer saved. Recovery keys context/path inside the frontend's
workspace/session namespace, not the currently installed socket. All auxiliary
parts use those records once through the same authoring owners.

Project selection is a workspace-attachment operation. It resolves source
contexts and recovery namespaces, settles the old workspace's dirty/review and
operation lifetimes, and then replaces that attachment. It neither installs
media nor runs a program as an incidental side effect. The loaded-project
catalog is a concrete initial producer, not the architecture's project limit.

## Opening, activation and commands

Opening resolves the canonical working copy and exact contribution/subject.
Matching views deduplicate **within a group**, not across all parts. Each view
has a distinct workspace-owned presentation identity, independent of the
resource/subject key used to find matching views.
An ordinary move preserves that live view identity. Close/reopen creates a new
view; coalescing preserves the destination identity and retires the source one.

Ordinary open routing is deterministic:

1. An explicit destination group wins and reuses its matching view.
2. Otherwise the contribution's opener chooses its normal area: Scene/Home use
   the main part; other authored assets use document parts.
3. Prefer a matching view in the invoking group when it belongs to that area;
   otherwise raise the most recently activated matching view in that area.
4. With no match, open in the invoking eligible group, otherwise the most
   recently activated eligible group. With no document group, that concrete
   open creates a document part and its first group.
5. An explicit additional-view action supplies another group/window. It does
   not create duplicate matching tabs in one group. A move transfers ownership
   rather than creating another input over a copied document.

The main subject is not replaced when routing to document parts. An asynchronous
open belongs to its destination group: replacement, close or workspace retirement
revokes attachment admission before a late result can attach. Another group's
independent open does not invalidate it.

Attachment and activation are separate admissions. An open captures its departure,
destination and activation intent. If the user activates another group while it
resolves, it can still attach to the valid destination without raising that part
or stealing focus. Completion never infers its subject from the later-focused
control or treats a live destination as permission to activate it.

Inputs are not shared as disposable objects between groups. Reopening an
existing view activates it; an explicitly additional view owns separate view
state over the same working copy. Source edits publish through the canonical
model to every retained projection, including the main tool behind the window.
Parsing/indexing remains cached by the owning model and generation, not repeated
per visible window or frame.
Parts consume shared semantic/index generations and perform view layout on
their own invalidations. They do not create another compiler, semantic project,
filesystem transport, runtime loop or per-frame source reconstruction. Closing
views releases their projections/subscriptions; workspace dirty recovery has
its own lifetime rather than an accidental hidden pane keeping it alive.

Moving a view transfers group ownership after detaching its old pane; it is
different from closing/disposal or opening another view. Group removal cannot
dispose an input still owned by the destination group.
When the destination already has a matching view, the move coalesces into that
view and applies the moved view's contribution-owned view state, preserving the
shared document. The departing view is retired only after that explicit
destination is admitted. Models retained there need no dirty-close decision;
any composite working copy losing its last view still does. Navigation references
are retargeted by the move operation, not by input-disposal fallback. The old
control's popups, asynchronous input and command-origin capabilities retire;
they do not gain authority over the surviving control merely because history
can refer to it.

Keyboard focus, active part, hovered surface and command subject remain separate:

- A focused control supplies the keyboard/clipboard/native-text target.
- A command invocation carries its part, group and concrete control/input subject.
  Menus and popups retain that origin while focus temporarily moves into them.
- An asset's Source action opens the matching location in the document part;
  an unrelated main selection or later-focused tab cannot substitute its model.
- A root command with no document subject is explicitly workspace-scoped.
  Save/Undo and subject commands never guess a document from a global tab.
- Source-consuming commands accept the focused control's draft through its
  existing edit boundary before reading canonical source. Its subject owner
  resolves the surviving occurrence after that publication, rather than acting
  on a removed subject or substituting another selection.
- Back/Forward records the part/group plus the existing reopenable
  resource-editor or retained-input identity and selection. A closed tab can be
  reopened in its surviving group. Group/part removal retires destinations in
  that scope, without clearing another scope's history or silently choosing a
  replacement window. Explicit view moves update their destinations.

The global active pane/group and `getActiveTab()` cannot remain implicit subject
providers for independently living parts. Likewise, pane teardown cancels only
its own capture/focus scope. These are ownership changes, not renamed globals,
state-swapping around drawing, or wrappers that forward to the old singleton.

Modal admission follows ownership rather than paint promotion. A popup that
escapes its group's clip still belongs to the invoking group's admission family.
A later local modal or owner retirement revokes that popup and its gestures even
when the popup's presentation parent is outside the blocked group. Part-local
prompts/pickers block their part, while workspace replacement/close prompts block
the workspace; promoting a popup cannot escape either boundary.

Session ownership is explicit, rather than making every chooser another global
single-session control:

| Interaction | Session owner and admission |
| --- | --- |
| Command Palette or workspace-wide file search | One workspace interaction, with its invocation/destination context retained while root-modal. |
| Part-specific chooser or close prompt | The requesting part/operation; blocks that part. Independent parts can retain independent local sessions. |
| Context menu/submenus | One active popup family for the frontend display, owned by its invoking control. Opening another family dismisses the first rather than transferring its command authority. |
| Inline field/property interaction | The actual control/input binding and its existing commit/cancel lifetime. |

Shared control implementations and immutable command/menu contributions are
reused. Part-local sessions do not compete for a root controller's single slot,
and a separate command/semantic/filesystem service is not manufactured for each
prompt or window.

## Execution and input

Physical input is produced once at the frontend/host boundary, not once per
editor part. Each actual target retains its own admitted input contributions
and execution/frame owner. The main view being visible behind
an asset editor does not give it keyboard/controller input or a second update
loop. Pointer routing still uses the shared surface order and whole-gesture
owner; native text input uses the actually focused control's arranged viewport.

Run/debug commands and timeline controls name an existing explicit transport.
An authored scene selection is not a runtime selection. Opening, painting,
raising or closing a document window issues no extra Run, Boot, Continue,
frame-step or reset operation.

The pause-while-authoring policy belongs to the workbench interaction owner and
the affected target, not a boolean written by each painted pane. The permanent
main tool must not pause all Play sessions forever, and a visible preview must
not override an author's or debugger's hold. Focus return may recompute the
ordinary workbench hold; it does not clear user pause, debugger or inspection
holds. Target-bound inspection operations retain their existing execution owner.

The interaction owner resolves the focused control's part/group and explicit
runtime binding; a transient retains the invoking context while it owns focus.
It retains an activated client context independently of hover/stacking and
publishes target-bound workbench holds to the existing execution owners:

| Activated interaction | Automatic workbench hold |
| --- | --- |
| Authoring: Home, Scene or a document control | Hold the attached primary authoring target, if present. Background Play/test targets retain their explicit run/debug policy. |
| Live guest client for the primary target | Release only that target's automatic UI hold; other holds still apply. |
| Live guest client for a Play target | Keep the primary authoring target held; release that Play target's automatic UI hold only. |
| Stopped inspection of target R | Hold R through the inspection interaction and keep the primary authoring target held; unrelated Play/test targets retain their policy. |
| Explicit live-follow/capture mode for R | Release R's automatic inspection/UI hold, not user/debugger/history/finite-operation holds. Keep the primary authoring target held when R is a different target. |
| Menu, popup, picker or prompt | Inherit the invoking interaction's policy. Modality restricts UI admission; opening a transient does not independently pause/resume a target. |

With no execution attachment, authoring publishes no physical execution request.
An explicit Pause/Stop is target-owned and survives focus changes; an automatic
UI hold is not a substitute for it. Focus return recomputes that ordinary policy
without an extra Continue command. This transient rule deliberately replaces
the present primary-only pause side effect of showing menus/Quick Input.
Chrome/transients retain an admitted activated client context rather than
searching visible panes when there is no focused leaf. Retiring that client
uses normal focus-return/activation to select a surviving context. The host
menu's own pause policy remains a separate host responsibility.

Background panes do not publish competing hold values. Global run controls and
audio monitoring bind to the explicitly selected run target; window-local
runtime commands/timelines bind to their own transport/invocation target. Opening
Source does not silently select another audio/debug target. Retirement of a
target retires those bindings, rather than redirecting its commands to the main
machine. This replaces single-active-pane inference at composition, host-frame,
audio, transport and timeline boundaries together, not at one fallback callsite.

## Close, layout and restoration

Closing an asset tab ends that view. A workspace-owned close operation identifies
the explicit affected views and **all** their working copies, including composite
inputs' `getWorkingCopies()` rather than only their primary resource. Closing an
editor window applies that operation to its groups, including one dirty-close
decision per working copy whose last view would close. Save/Discard/Cancel is presented through the
existing prompt UI and executed through working-copy/recovery owners before
retiring the affected inputs. Cancel leaves the unclosed views available;
already completed Saves are not rolled back. Closing one of several views does
not discard their shared document.

The operation re-enters admission after awaited work. A successful Save receipt
acknowledges the source version it captured, not necessarily the model's current
contents. A sibling view can edit the model or open another view while a local
prompt/Save is pending. Before destructive Discard or final last-view retirement,
the operation re-evaluates current canonical dirty/version state and which views
will remain. A stale decision cannot discard a newer edit or another part's
document; another required decision stays visible instead of silently closing.

Close admission first resolves the focused control's actual pending edit,
then the affected canonical working copies. A part-close prompt blocks that
part; a workspace-close prompt blocks the workspace. Successful asynchronous
Save/close completion does not take focus from an unrelated active part. Focus
return belongs to the still-admitted invoking context, not to a stale global
active-pane pointer.

This last-view admission is a required new close policy. The present tab-close
path disposes inputs while dirty models/recovery can outlive their views; it
does not already provide a Save/Discard/Cancel protocol to reuse unchanged.

Collapse or temporary covering retains views, working copies and reading
positions while revoking unavailable input. Pending field drafts follow their
actual control's commit/cancel contract; availability or authority loss can
cancel them, and return of space or rights does not resurrect them. Covering
is not a disguised Close or a promise to keep an inadmissible draft alive.

The main editor part closes only with its workspace/frontend, not through
Close All Editors. Closing its last tab leaves the main part/project navigation
alive. Tab/group-close commands target their invocation group; closing a document
window targets that part's groups. Workspace-wide close requests are explicitly
workspace-scoped. A document window's owner is the workspace rather than the
currently selected main tool. Changing the main tool therefore leaves that
window open. Close and focus return retire only the relevant owned popups and
gestures, preserving independent sibling interactions.

Layout consumes the frontend's published logical work area and current font,
not a game's scanout size or a copy of the Unreal screenshot. Project navigation
and inspector regions can become drawers on a narrow work area; the document
window can maximize within it. State survives that rearrangement. Main and
document chrome have distinct visible activation, compact semantic actions and
shared single-glyph truncation. Placement/reflow belongs to the layout/window
owner, never to an asset-specific workaround.

Workspace persistence records the main groups/subjects/views, document-part
groups, window placement and active part. It records working-copy recovery once,
not one source copy per window. Restoration resolves dirty models before attaching
views; restoring geometry or focus does not boot or resume a target. Runtime
handles and target-specific evidence do not become persistent asset identities.
Restored focus is presentation-only: live guest-input/capture authorization and
automatic-hold release are not persistent view state. A restored runtime view
cannot enter the table's Live/running-capture modes until explicit target
interaction admits that mode against the current target lifetime. Initial
workspace interaction is Authoring, even if a runtime view's chrome was active
in the saved layout. Separate explicit host startup/Boot policy remains with
the execution owner, not the layout restorer.
Group/input serializers identify each distinct view and its model/subject
reference; they do not resolve several restored views through one global
input-manager entry keyed only by resource. The owning persistence format must
represent source contexts and all part/group relationships before this layout
is published as restorable.
Persistent layout/view mementos contain plain contribution-owned restore data
and references between records. Restoration constructs distinct live inputs and
control identities; it does not revive an old live id as command authority.
Navigation's tracked-range selections and control/popup handles remain
session-local rather than being serialized as layout mementos.

## Construction gates

The target composition has a retained main authoring client and independent
document parts/groups. Before its UI is built, the group/pane, command-subject,
navigation, capture-scope and recovery owners above must have explicit
construction and teardown paths. The main client must perform real source-backed work; a pinned
Home tab, empty decorative frame or captured game image does not satisfy it.

Source controls have instance-owned layout/completion/Find/Rename/caret state.
Two independent Source views over one working copy are a construction proof,
not an optional future architecture exception. More document windows are not
simulated by swapping global source state. Native auxiliary windows remain the
separate host boundary already defined by the windowing design.

The existing single-client assumptions must change at their owners together:

| Boundary | Required ownership change |
| --- | --- |
| `workbench/workbench.ts`, source/catalog, model and Save composition | Separate authoring authority from execution attachments; admit logical source contexts centrally. |
| `services/editor/editor_group.ts`, `ui/tab/`, `services/editor/editor_panes.ts` | Part/group-owned inputs and controls; scope-specific retirement instead of singleton selection/reset. |
| `editor/ui/code_editor_state.ts`, view/layout and editor contributions | Control-owned source interaction/viewport state, with shared model/semantic/font-generation producers. |
| `commands/controller.ts` and contribution controllers | Explicit invocation input/group/transport instead of global active-tab subject discovery. |
| `navigation/navigation_history.ts` | One workspace history of scoped destinations; no constructor/dispose reset from each group. |
| `cart_editor.ts`, `host_frame.ts` and runtime controls | One explicit interaction/run policy feeding target-bound execution, input, audio and timeline owners. |
| Workspace models/storage and contribution serializers | Context-aware recovery plus independent part/group/view mementos and ordinary close admission. |

These are dependency boundaries to verify before UI construction, not permission
to move the same global code behind an `EditorPart` facade. Existing surface,
render-command, focus and capture machinery remains shared at its real owner.

Acceptance concerns the following observable contracts, not label snapshots
or fixed pixel positions:

| Scenario | Required result |
| --- | --- |
| Open/edit/close an FSM or BT above a main Scene view | Main subject, selection and viewport survive; both views observe canonical source changes. |
| Invoke Source/Save/Undo through a popup, then change focus | The invocation targets its original admitted input; retired origins cannot act on a replacement. |
| Resize/cover/collapse one surface during a hold | That surface loses input and drains its gesture; a sibling's unrelated capture survives. |
| Complete an open after its part/workspace has closed | No late attachment or focus transfer into another part. |
| Close another view of a dirty model, then the last view/window | Shared history survives the first close; the final close resolves the ordinary dirty decision once. |
| Navigate across parts, dispose one, and restore a workspace | Destinations remain explicit; models recover once; no accidental execution or runtime-handle resurrection. |
| Restore an active runtime-view memento over an attached target | The view can regain presentation focus without granting live input/capture or releasing execution holds. |
| Open two Source views over one model in different groups/windows | Text/Undo/Save are shared; caret, wrapping, scroll, completion, Find and native input remain independent. |
| Use identical paths in distinct source contexts and repeated runtime ids in different targets | No model merging, project reclassification, wrong-target inspection or recovery collision. |
| Use both fonts in narrow and larger work areas | Reachable commands and retained state survive drawer/maximize changes without forced permanently visible panels. |

Home/menus expose actual entrypoints for FSMs, BTs, Action Effects, Scene,
Animation, Audio Events, Progression and Input Bindings. The project content
browser provides their persistent navigation; context-specific edit/run actions
stay with their actual subject. Discovery is not implemented by duplicating
feature controllers inside Home or by advertising unsupported creation actions.
