# Cartlib read-only inspection ABI

## Ownership and lifetime

Cartlib's stored tables are the producer. Studio's Actor Lab, Behavior Lens,
Event Viewer and tool services are same-build read-only consumers. The layout
below is an explicit tooling contract even where a member has an underscore;
it does **not** make that member a gameplay mutation API. Change a layout only
with its producers and inspectors in the same change. This is not a serialized,
version-negotiated SDK for independently upgraded cartlib packages.

There is no guest reflection service, instrumentation call, copied runtime DTO,
extra instance field or compatibility fallback. Inspectors borrow actual guest
values at a suspension boundary and use guest tags/identities. Resume, heap
replacement and image replacement retire their handles. Editable source or
source registration names are not evidence that an instance exists.

This follows the library-aware approach used by
[LLDB's data formatters](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/lldb/examples/synthetic/gnu_libstdcpp.py),
without their cross-library-version recovery heuristics.

## Retained layouts

| Producer | Read surface and meaning |
|---|---|
| `cartlib/registry` | `_entries_by_key[class].items` is the dense, one-based membership array for the actual class-table key. An absent bucket has no members. It is not a source-name index. |
| `cartlib/world/world` | The exported singleton's `_objects` is admitted world membership, not pending spawns or a heap census. It is a dense one-based array of objects. `_render_visuals[1.._render_visual_count]` is the retained, visual-order-sorted render lane, not `_objects` order. |
| `cartlib/world/world_object` | `_components` preserves owner component ordering; `_components_by_class[class]` contains the components of that class. Each component's `_owner_component_index` indexes `_components`. `id` and `active` are the object's stored identity/activity. Optional `spatial` is its actual Transform component, not a position record beside that component. |
| `cartlib/component/transform_2d_component` | `xx,xy,yx,yy,ox,oy` store the column-major local affine. `spatial_parent` is the concrete parent Transform or nil. `owner` is the WorldObject. No object `x/y/z` aliases exist. |
| `cartlib/component/transform_3d_component` | `xx,xy,xz,yx,yy,yz,zx,zy,zz,ox,oy,oz` store the column-major local affine with the same concrete parent/owner relationship. 2D/3D family admission belongs to prefab/World, not a field-shape probe in Studio. |
| `cartlib/component/visual_component` | `owner`, `draw`, `visible`, `order` and `presentation_order` describe visual dispatch and ordering. Owner `visible` participates in draw admission; it does not supply a spatial depth or visual offset. |
| `cartlib/component/visual_2d_component` | `spatial` binds the actual Transform2D. Flat `attachment_xx/xy/yx/yy/ox/oy` and `presentation_xx/xy/yx/yy/ox/oy` compose as `objectWorld * (attachment * presentation)`, preserving the guest owner's Number-operation grouping. |
| `cartlib/component/sprite_component` | `draw_visual` and `draw_region_visual` are actual guest function identities. `source_width/height` and `region_width/height` describe local rectangular geometry through the 2D visual affine. These are not collider bounds or an ABI for arbitrary custom draw functions. |
| `cartlib/fsm/fsm_component` | `_machines[1.._machine_count]` retains construction order; each machine's `localdef_id` is its component-local key in `_machines_by_id`. These are actual retained machines; `_started` is its execution state. It is not the global definition registry. |
| `cartlib/fsm/fsm` | Each instance owns `definition`, `states`, `state_ids`, `current_id`, `data`, `id` and its retained hierarchy. Follow `state_ids` into `states`, never parent/root backlinks. Definition fields describe loaded configuration, not unsaved editor text. |
| `cartlib/behaviour_tree/bt_component` | `tree_id`, `blackboard`, `_execution_state`, `_active_services`, `_active_service_count`, `_execution_waiting` and `_execution_request_pending` belong to this instance. Execution slot indices are compiler-owned, not authored node IDs. |
| `cartlib/behaviour_tree/blackboard` | `_layout.keys[slot]` names `_values[slot]`; `_layout.initial_values[slot]` is the loaded default. `_layout.slots_by_key[key]` resolves the semantic key that survives rebind; pins follow that key, not its former dense slot. The final declaration wins for repeated keys, as in `compile` and `rebind`. Shadowed declarations remain separately identified display rows, not independent logical watch targets. Nil `_layout`/`_values` during construction/rebinding is an observable intermediate state, not permission to manufacture defaults. |
| `cartlib/timeline/timeline_component` | `_entries_by_id[id]` contains retained playback entries; their `playing` value is instance state. |
| `cartlib/actioneffects/actioneffect_component` | `effects[id]` contains granted instances; `active_count` is instance activity. The instance's loaded definition is distinct from an editable registration. |

Transform and visual `w*` fields are derived guest caches; suspension does not
execute their refresh. A read-only geometric projection captures local
coefficients and concrete parent links within one observation, composes them
with the host affine kernels, and releases borrowed guest identities before
execution resumes. It does not call guest getters, populate guest caches or
retain an authoritative host World. Geometric hover is not pixel-accurate or
completed-frame render provenance.

Constructors and world structural barriers own these invariants. A generic
value viewer can show arbitrary values; a cartlib-specific inspector consumes
this layout directly. Do not add runtime schema validation to every read.
Existing Lua APIs continue to own deliberate mutations and test execution.

## Event entry

The public target is `cartlib/event_emitter` → `event_emitter.emit`:

| Zero-based formal position | Meaning |
|---|---|
| 0 | implicit method receiver |
| 1 | event name/value |
| 2 | emitter object |
| 3 | payload |
| 4 | emitter identity retained by the event port |

Event Viewer reads positions **1, 4, 3** before the first retained statement,
including unhandled events and nested dispatch. Parameter spelling is not part
of this ABI. The compiler's local debug slots carry `argumentIndex` independently
of register number and name, as LLVM's
[DILocalVariable](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/include/llvm/IR/DebugInfoMetadata.h)
carries formal argument identity. Inlined copies retain the same argument
index plus their inline call chain. Binding happens once per image replacement.

If symbols, function or a live physical operand are absent, observation is
explicitly unavailable. Do not add guest instructions, force a lower
optimization level, infer a value from source or consult a similarly named local.

## Evidence

`tests/lua/event_history.test.ts` executes real cartlib dispatch at O0/O3,
including a parameter-renamed source variant and a complete CPU-state/cycle/heap
comparison with observation disabled. `function_probe.test.ts` covers native
and inlined entry locations; TS and C++ symbol tests retain formal identities.
Actor/behavior inspection tests cover retained identity, membership, suspended
lifetime and stored values; they are not proof of every arbitrary cart layout.
Debug/release execution-equivalence tests remain required for metadata changes.
