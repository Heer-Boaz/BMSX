# Cartlib object and transform hierarchy

## Purpose and design boundary

This document defines cartlib's intrinsic gameplay object model: how a game
constructs, places, moves and relates its objects. Its requirements come from
gameplay, rendering, collision, animation and execution cost.

Cartlib is an independent gameplay library. Authoring and inspection tools are
consumers of that library; their implementation needs do not define its Lua API,
object layout, construction rules or supported gameplay expressions.

The public contract describes objects, position, rotation, scale, parents,
components and Scenes. Construction lanes, dimensional dispatch, mutation
permissions, matrix coefficients, dirty bits and compiler bindings belong to the
implementation. Exposing one of those mechanisms requires a gameplay use case;
being convenient to parse, inspect or visualize is not one.

## Object model

The object model has three foundational built-in object classes:

| Type | Gameplay meaning |
| --- | --- |
| `WorldObject` | A nonspatial object with identity, behavior, components and a lifetime. |
| `Object2D` | A WorldObject with an intrinsic 2D position, rotation, scale and spatial parent. |
| `Object3D` | A WorldObject with an intrinsic 3D position, rotation, scale and spatial parent. |

The spatial object itself owns its transform and hierarchy identity. It is not a
WorldObject facade forwarding to a separately allocated transform component.
Components add behavior, visuals, collision geometry and other capabilities;
they do not add another authoritative object position.

A transform is therefore automatic for Object2D/Object3D and absent for an
ordinary WorldObject. Adding a sprite is not how an object acquires a transform:
an empty spatial grouping object is useful, and a nonspatial controller must not
pay for a fabricated identity transform.

### Class and prefab construction

A prefab is a reusable construction definition for an object and its components.
Its object type comes from its class lineage, not a second spatial declaration.
A built-in class can be used directly:

```lua
local object_2d<const> = require('cartlib/world/object_2d')
local prefab<const> = require('cartlib/world/prefab')

prefab.define({ def_id = 'attachment', class = object_2d })
```

A gameplay module declares its class lineage using ordinary Lua prototype
inheritance. This is the same table-valued `__index` convention already used by
cartlib's concrete component and object modules, not a new class framework:

```lua
local ship<const> = setmetatable({}, { __index = object_2d })
prefab.define({ def_id = 'ship', class = ship })
```

Gameplay methods are declared on `ship` normally. There are no required empty
constructors or lifecycle hooks; a prefab without custom behavior uses the
built-in class directly instead of declaring `ship` at all.

The module owns that inheritance declaration. Prefab registration reads the
established lineage and captures the built-in construction type, methods and
callbacks; it does not write to the class or its metatable. Registering a second
prefab for `ship` cannot change its superclass. A prefab-specific `base` field,
a parallel `type` selector and an `extend` forwarding helper are unnecessary.

Custom object classes derive from WorldObject, Object2D or Object3D, directly or
through another gameplay class. A table-valued prototype chain is a deliberate
class contract: runtime instances use the compiled method surface, not arbitrary
dynamic `__index` execution. Game constructors and methods remain ordinary Lua.
There is no restriction that their bodies be declarative or statically readable.

Admission captures each definition's methods and callbacks once. Existing
instances and staged Scene spawns retain that definition when a later
registration replaces it; they do not follow mutable global class bindings or
run class-chain lookup on every dispatch. Method functions and their captured
gameplay references retain their actual identity, rather than being deep-cloned.

There is no obligatory empty `class = {}`. Omitting a class selects WorldObject;
selecting Object2D/Object3D supplies a meaningful built-in type. A prefab can
supply default position, rotation or scale, but an identity transform does not
need to be declared.

Prefab registration compiles shared methods, constructors, component factories
and initialization defaults once. Instances share executable methods; they do
not receive copied class graphs or per-instance method closures.

## Placement and construction inputs

Ordinary placement uses semantic values:

```lua
scene_library.register('hangar', {
    objects = {
        {
            member_id = 'ship',
            definition_id = 'ship',
            position = { x = 160, y = 120 },
            options = { team = 'player' },
        },
        {
            member_id = 'turret',
            definition_id = 'turret',
            parent = 'ship',
            position = { x = 12, y = -4 },
        },
    },
})
```

Omitted position means the prefab's default position; omitted rotation and scale
likewise retain their defaults. Built-in defaults are zero position, identity
rotation and unit scale. Position and scale overrides may name individual axes;
unnamed axes retain their prefab values. Rotation replaces the complete angle
or quaternion atomically: missing quaternion operands are not inherited from a
different prefab rotation. An explicit zero or unit value can override a
nondefault prefab value.

For Object2D, rotation is an angle in radians. For Object3D, rotation is a
quaternion with named `x`, `y`, `z`, `w` operands. Scale has named `x`, `y` and,
in 3D, `z` operands. A 3D identity quaternion does not have to be written.
The concrete type determines which properties exist.

Scene member IDs support gameplay references and staged spawning. `parent`
identifies a spatial member in that Scene definition, including a later member;
it is not an index, Registry ID or display caption. Each live Scene resolves it
to its own concrete instances. An ordered member list supports those references
without making list order a construction dependency.

Procedural construction and Scene construction use the same semantic placement
and lifecycle. Procedural parenting takes an actual object reference rather than
looking up a Scene-local name:

```lua
local ship = scene:spawn('ship', {
    position = { x = 160, y = 120 },
    team = 'player',
})
scene:spawn('turret', { parent = ship, position = { x = 12, y = -4 } })
```

Both `world:spawn(definition_id, options)` and
`scene:spawn(definition_id, options)` take this single construction input.
Omitted options use a shared empty input, not a required empty table at each
callsite. Separate spatial-input and component-initialization arguments are not
part of the public contract.

Prefab `position`, `rotation` and `scale` fields supply semantic pose defaults.
Its `defaults` table supplies ordinary gameplay properties. Nonreserved spawn
fields shallow-override those properties on the final object before gameplay
initialization. This preserves useful construction such as `room`, `player`,
`team` and `damage` without requiring assignment-only constructors or a property
schema. Reference-valued gameplay properties remain their actual references.

World consumes the public `id`, `space_id`, `tags` and `visible` construction
controls, including their prefab defaults, at their owning initialization
boundary. Pose records and `parent` are likewise construction inputs, not
arbitrary tables to copy onto the object. World-owned runtime indexes, lifetime
fields and captured executable methods are not gameplay override targets. The
separation belongs to central admission, not feature-specific field filters or
a new runtime validation layer.

Construction inputs are consumed at admission. Numeric pose values are copied
into the actual object's scalar state before user callbacks; retaining a
caller's position table as live object state would be an ownership error. A
caller can reuse a construction input without allocating a new position record
for every spawn. Constructors borrow their input read-only for construction;
they read effective placement and defaulted properties from their actual owner.
World does not build a merged options/context record for each instance. Script
options and explicit reference-valued gameplay data have their own documented
ownership; construction does not deep-clone arbitrary data.

Components retain their own meaningful configuration and constructors. Generic
property-path override interpreters or component-initialization inventories are
not prerequisites for object placement. Any general prefab-override facility
needs its own gameplay purpose and construction semantics.

## Local and world transforms

### Geometric authority and semantic editing

The actual object stores its local affine and a retained world affine. The world
pose is `parentWorld * local`; a root's world pose is its local pose. Arbitrary
shear, reflection and singular bases remain geometric values, not reasons to
repair a pose or allocate hidden intermediate objects.

Ordinary gameplay uses position, rotation and scale rather than coefficients.
Object2D uses an unwrapped angle in radians and supports skew. Object3D uses a
unit quaternion. The type supplies identity placement without an authored matrix
or transform-permission declaration. Imported/model-node transforms can instead
supply a named `transform` record using the central affine representation:
`xx`, `xy`, `yx`, `yy`, `ox`, `oy` in 2D; the corresponding nine basis and three
origin fields in 3D. The record is a construction input, not a live pose proxy.

Semantic editing channels are cached on the same actual object. Explicit semantic
writes retain their angle/quaternion and signed scale, even at zero scale;
restoring scale therefore restores the specified rotation. A raw basis replacement
invalidates this knowledge. Reading semantic values never rewrites the geometric
pose. Position-only edits and Keep Relative do not invalidate basis knowledge.

Matrix-derived values use fixed conventions:

- In 2D, scale is the column lengths, with a negative determinant carried by Y.
  Rotation comes from the first column; skew describes the second column relative
  to it. Missing required axes make rotation/skew unavailable.
- In 3D, scale is the column lengths, with reflection carried by Z. Rotation uses
  the first two independent columns and their proper cross-product orientation.
  A zero first column or parallel first two columns makes it unavailable; a zero
  third column alone does not.

Unavailable extraction is memoized until the basis changes. It returns `nil`, not
an invented angle/quaternion. These conventions are editing projections, not a
promise that arbitrary affine geometry can round-trip through rotation/scale.
In particular, explicitly setting 3D rotation or scale rebuilds `R * diag(S)` and
replaces existing shear. Merely reading, evaluating or reparenting never does so.
A complete pose write needs no decomposition of its previous values. A partial
write fails only when a channel it must preserve cannot be determined.

Quaternion production and interpolation belong to the central math owners.
Setters consume their representation without repeated normalization, epsilon
repair or defensive validation.

### Gameplay operations

Operations belong to the actual Object2D/Object3D:

```lua
object:set_position(x, y)          -- relative to its spatial parent
object:set_rotation(angle)        -- Object2D, radians
object:set_scale(sx, sy)

local x, y = object:get_global_position()
local committed = object:set_global_position(x, y)
```

The 3D counterparts consume three position/scale operands or four quaternion
operands. A complete `set_pose` operation publishes its semantic values with one
invalidation. A partial setter preserves the other editing channels according
to the rules above and returns whether it could publish. `get_transform` and
`get_global_transform` return full affine scalar tuples; their setters accept
the same tuple. `set_global_pose` supplies a semantic world pose while solving
the exact relative affine under its parent. There is no second world-TRS
authority or hidden override of the composed geometry.

Getters return scalar tuples rather than allocating vector tables. World reads
resolve the actual object's dirty pose; gameplay does not run an internal
resolver and then read cache fields. Mutating borrowed cache coefficients is not
another public pose API.

Forward point/vector transformation remains defined at zero scale. An operation
that requires an unavailable inverse fails before changing authoritative values;
world-position assignment returns `false`, and inverse conversion returns its
explicit failure result rather than a substitute coordinate. Root world-position
assignment and detachment to a root need no parent inverse.

This is a deliberate cartlib rule, not a copy of UE's
[zero-reciprocal handling](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/TTransform):
cartlib neither replaces zero scale with epsilon nor fabricates inverse values.
Representable values are not repaired to make an operation appear successful.

## Attachment and lifetime

### Explicit attachment rules

Parenting separates coordinate relationship from lifetime ownership.
`world:reparent(object, parent, keep_world, on_completed?, context?)` requests a
concrete same-dimension parent, or `nil` for a root. `keep_world` selects:

| Rule | Meaning |
| --- | --- |
| `false`: Keep Relative | Keep the full local affine and its known semantic editing channels under the new parent. |
| `true`: Keep World | Preserve the full resolved world affine, including shear and singular child geometry. |

Keep World computes `inverse(newParentWorld) * currentWorld` before changing the
edge. Only the new parent's inverse is required. Detachment to a root simply
copies the full world affine into the local affine, including under a singular
old parent. Keep Relative requires no inverse. A singular new parent rejects
inverse-dependent placement without changing the local pose or topology.
An already-current relationship commits without pose/cache changes or inversion.

These rules use the familiar explicit Keep Relative/Keep World distinction from
[UE attachment](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/EAttachmentRule)
without importing its TRS-only numerical projection or zero-reciprocal recovery.
Snap placement can be expressed by Keep Relative followed by an explicit local
pose; there is no per-channel attachment-rule framework in this API.

### World mutation and completion

World commits topology at its existing structural barriers. Parent links refer
to concrete objects in the same World and dimension, not necessarily the same
concrete gameplay class. The placement rule is retained when the request is admitted;
pose and topology are evaluated when it commits. Keep World therefore uses the
object's world pose at that commit, not a stale pose captured when enqueuing.
Requests for the same object apply in their queue order.

Attachment and detachment have no success return that could mean either queued
or committed. An optional `on_completed(context, result)` observes exactly one
terminal result per admitted request:

| Result | Meaning at commit |
| --- | --- |
| `committed` | The requested relationship and placement rules have been applied. |
| `retired_target` | A participant is retiring or retired, including when World clear closes its generation. |
| `invalid_relationship` | The World, dimension or cycle relationship is incompatible. |
| `singular_parent` | A selected world-preserving operation requires an unavailable parent inverse. |

These are shared result constants, not newly allocated result records. A request
without a completion observer is a normal operation; it does not require a
no-op closure. Outside a structural group completion may run inline. Inside a
group it runs after that request's result is determined at the barrier, not at
enqueue or preflight.

World retains actual object references, the placement rule and caller
callback/context in reusable queue storage. It removes the request's retained
references and advances the drain cursor before invoking user code. Reentrant
requests join the drain with the barrier still open; they do not recursively
publish a partially constructed batch. No promise, request object or separate
operation-broker service is needed.

Synchronous world-position assignment returns `true` on publication and `false`
when the required inverse is unavailable. Inverse point/vector conversion
returns `true` followed by its scalar coordinates, or `false` without fabricated
coordinates. Failed writes change no local pose, parent edge or dependent
contact latch and cause no write-induced invalidation. Resolving an existing
dirty cache still reflects its actual inputs; it is not an authoritative write
to undo.

### Ownership and removal

Attachment is a coordinate relationship, not automatic lifetime ownership.
Components belong to their object, and a live Scene owns its object set for
unloading. Space membership selects scheduling/render membership and is not a
coordinate frame. Attaching an object does not change its Scene, inherit
visibility or make the parent own every attached object.

This distinguishes an attached gameplay object from an owned subobject, just as
UE has an explicit
[ChildActorComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UChildActorComponent)
for an actor that a component creates and destroys. Cartlib does not need an
additional ownership mechanism merely to support spatial attachment.

At removal of a parent:

1. World determines the actual retiring set at its barrier.
2. It resolves retiring objects and each surviving direct child's full world
   affine while the old ancestry is still present.
3. Those children detach with Keep World into roots; their Scene membership and
   local descendant relationships remain intact.
4. World disconnects the retiring objects from the hierarchy across the whole
   set before invoking any retirement hook.
5. Normal object/component teardown follows. Removals requested by hooks join
   the next removal batch in the same drain.

No new inverse is needed for this detach, including when the old world scale is
zero. Removing one Scene cannot thereby destroy a child owned by another Scene.
A separately requested subtree removal is an explicit operation over the actual
hierarchy, not an implicit side effect of removing one object. An unadmitted
batch child whose required parent is canceled is canceled before publication;
it is not a live independent child undergoing this detachment policy.

An attachment result callback is distinct from a Scene-unload continuation.
World clear supersedes pending unload continuations so they cannot start an
incoming Scene while the World is closing. It still completes observed
attachment requests with their terminal result.

## Physical movement

The tile motor is an optional movement component on an ordinary Object2D. It
moves that object's world-space position through an explicitly supplied,
world-axis-aligned rectangular footprint in a tile collision world. The
footprint belongs to the motor, not to the object's visual transform.

Rotation and scale remain normal Object2D operations. They do not implicitly
rotate or resize the tile motor's world-space rectangle. Collider2D separately
owns overlap geometry, which may follow the object's full rendering transform.
Those are different collision questions, not two authorities for object position.
A TileBody2D class or prefab transform-permission flag is not needed merely to
select a cheaper world-position writer.

The sweep guarantee is for integer world-pixel starting coordinates, footprint
offsets and displacements. Fractional velocity accumulation belongs to its
existing integration producer. The motor is not a continuous fractional sweep:
representable fractional operands still flow deterministically through its
arithmetic, but do not acquire a stronger collision guarantee. The motor does not
round, repair or repeatedly validate owned inputs in its frame loop.

The intended operation/result shape is:

```lua
motor:set_footprint(-6, -12, 6, 0) -- offsets in world pixels
local committed, contacts = motor:move(dx, dy)
```

The solver calculates the proposed position and contact bits in scalar locals.
If position changes, it solves the actual object's world-position write against
its current parent, then publishes the pose and contact latch on success. An
inverse-dependent publication failure returns `false` with both previous pose
and contact latch unchanged. A successful operation returns `true, contacts`.
No earlier state write is undone; proposed results are not committed results.
Root-position publication keeps its direct fast path. Ordinary position setters
do not acquire motor-kind checks.

Only motor-requested motion is swept. Parenting, ancestor movement and ordinary
pose writes are unswept placement changes; attached objects are not recursively
swept. This follows the distinction made by UE's
[MovementComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UMovementComponent),
without claiming its continuous physics algorithms are this tile solver.

Disabling the motor while carrying an attached object, detaching it, then enabling
movement again is an ordinary component lifecycle. Gameplay supplies valid
starting placement when dropping it. The motor neither invents depenetration nor
changes the object's type or transform interface during that transition.

## Visual placement

Visual-local placement is independent of the object's physical pose. Components
resolve their actual Object2D/Object3D owner once per placement evaluation and
compose its world affine with their local geometry. Model-node and shape-local
transforms belong to the asset/geometry producer. Render-only recoil, bob or
squash need not move collision geometry.

The existing component attachment and presentation inputs retain their own
representation. Replacing them with one writable visual-local pose is a separate
component/animation change, not a prerequisite for intrinsic objects. It must
establish the composition of additive clips and rest placement at the animator;
adding more permanent pose authorities does not solve competing writers.

Sprite frames change image/flip bindings independently of physical placement.
Two-dimensional draw order belongs to the visual's actual order property, not a
third Object2D coordinate or an inherited parent depth. An attachment shared by a
sword visual and its hitbox is a meaningful Object2D child, not a fabricated
transform component.

## Animation

Grouped `position2`/`position3` channels address the actual object's local
position. Advanced `transform2`/`transform3` channels address the full named
local affine. Their grouped writers invalidate once; runtime cache fields and
hierarchy bookkeeping are not independent animation properties. Semantic
rotation/scale animation can use an ordinary apply callback and the object API;
quaternion interpolation belongs to the animation/math producer. A world-space
movement operation must retain its explicit inverse/failure contract rather
than treating an unsuccessful global write as a successful animation sample.

Channel admission binds concrete receivers and grouped writers once. A position
sample publishes its coordinates together and invalidates once. Evaluation does
not interpret property paths, discover types or walk class chains each frame.
Two-dimensional angles remain unwrapped so a track can describe multiple turns;
quaternion interpolation has explicit quaternion semantics rather than four
independent scalar interpolation tracks.

Physical animation writes object state in the physical phase. Presentation-only
animation writes visual placement in its presentation phase. Both consume the
existing sampled clock rather than advancing it independently. Simultaneous
channels have defined writer/order ownership, not several unsynchronized pose
stores.

## Construction and publication

The Scene compiler binds concrete prefab definitions, semantic defaults, member
identities, parent indices and parent-first construction order at admission.
A live Scene retains those definitions when a registration is replaced; staged
spawning must not mix a new constructor with an old retained plan.

A spawn batch prepares its final object shells and mathematical placement
before graph, Scene or admission-queue publication. A failed partial semantic
pose merge therefore cannot strand a structural barrier or publish earlier
members. Successful preparation initializes intrinsic topology before invoking
component or gameplay constructors. Components
receive the actual final owner. Constructors initialize their own object;
post-construction wiring runs only after the batch is constructed and published.
Subscription binding precedes activation of the batch. Callback-requested
structural changes join World's ordered drain rather than recursively
publishing a half-constructed batch.

Construction invokes the captured class initializer as
`initialize(owner, options)`, then each ordered `factory(owner)`, then
`ctor(owner, options)`. Initializer and constructor hooks are optional. Every
hook receives the final owner; initializer and constructor also borrow the
existing construction input. The definition
identity is already on that owner, not another positional constructor argument.
Admission has already installed effective pose and gameplay defaults before the
first hook. This ordering preserves initialization needed by component factories
and component access needed by the constructor without an extra context object.

Component factories receive the actual owner, with effective gameplay fields
already installed. Immutable component configuration is bound once
by the admitted factory; a game-specific factory may select configuration from
its real gameplay parameters before constructing the component. World does not
allocate another per-object context table merely to wrap `owner` or route a
generic component-initialization inventory. A built-in factory's optional
explicit configuration is the concrete component's input, not the actor's raw
spawn input. SpriteObject and TextObject consume their concrete primary visual
properties from the actual owner; ordinary additional components consume their
own bound configuration. Whole-object visibility remains distinct from an
individual component's enabled/visible state. Object placement likewise remains
separate from visual-local placement. Passing a different domain input
must carry actual additional meaning, not duplicate state already available on
the owner.

Scene registration compiles semantic member placement into retained scalar rows
and retains each member's gameplay options independently. Internal World admission
consumes those rows directly. It does not reconstruct a public options table
merely to pass the placement through the procedural interface again.

Staged spawning selects explicit members. A required parent must already be live
or be selected in the same batch. It does not implicitly spawn a namesake,
manufacture an identity parent or change the child into a root. Cycles and
incompatible composition are diagnosed at construction/topology boundaries,
not repeatedly while reading poses.

Scene construction, ordinary spawn and runtime reparenting use the same World
lifetime and barrier owner. No additional scheduler, identity broker, transaction
framework or constructor rollback is introduced.

## Execution design and cost

### Storage

The actual object stores a local affine, retained world affine, lazy semantic
editing channels, revisions and intrusive hierarchy links. There is no separate
Transform instance, vector/matrix proxy or per-object resolver closure.
Nonspatial WorldObjects allocate none of this spatial state.

Numeric pose storage, excluding flags/revisions and lifetime metadata, is:

| Object | Local affine | World affine | Editing channels | Total |
| --- | ---: | ---: | ---: | ---: |
| Object2D | 6 | 6 | 4 (angle, scale, skew) | 16 |
| Object3D | 12 | 12 | 7 (quaternion, scale) | 31 |

Unextracted channel fields need not occupy a table slot. Known semantic values
and unavailable extraction are selected by one flags word. There is no
world-rotation/scale cache. Storage accounting is not a measured speed claim.

The full budget also includes object identity, component indexes, subscriptions
and lifetime bookkeeping. An empty grouping node must be measured as an actual
WorldObject, not advertised as cheap by counting only its transform scalars.
It does not justify allocating unused tick/visual work or manufacturing such
nodes to compensate for an unsupported transform operation.
Intrinsic pose storage removes a separate identity; it does not make the whole
object a single allocation. Eager tags, event ports and component containers
need justification for empty grouping objects rather than automatic inheritance
from the existing base initializer. Shared methods already exist and are not a
new allocation saving to claim again.

Separate registration, instance admission, steady evaluation and retirement:

| Boundary | Account for |
| --- | --- |
| Prefab/Scene registration | Shared compiled methods, factory bindings, retained defaults and construction plans. |
| Object admission | The final object, tags, component indexes, event port, Registry/Space/Scene membership and queue growth. |
| Spatial admission | Intrinsic scalar/link fields and shared scratch capacity, without a Transform component or its class-index buckets. |
| Component admission | Actual component identities, geometry bindings and subscriptions, separately from an empty spatial object. |
| Steady evaluation | Allocations, emitted calls, cycles and repeated work at actual pose, animation, render and collision consumers. |
| Retirement | Teardown work, collected allocations and released queue, scratch and subscription references. |

Temporary construction records and table-capacity growth count even if they are
later collected. Measure empty WorldObject, Object2D and Object3D admissions
separately from component-bearing instances. A combined spawn/attach/remove
benchmark cannot establish a fixed per-object construction cost.

A world-position change does not run trigonometry, rebuild quaternion matrices
or rewrite an unchanged world basis. Rotation/scale changes rebuild the affected
basis only when needed; clean queries share the result. Ancestor changes compose
retained affine coefficients without decomposing matrices. Roots keep a
direct position path without a parent inverse or identity multiplication.

### Evaluation and consumers

Retain iterative dirty-ancestor resolution, separate world basis/origin revisions,
subtree invalidation that skips already dirty branches, stable hierarchy slots
and reusable scratch that releases retired references. Multiple consumers share
one recomposition between intervening writes. There is no mandatory full-World
transform pass before every frame.

Concrete 2D/3D kernels are selected at type/construction boundaries. Stable pose
reads, writes and traversal allocate no tables, vectors, closures, iterators or
formatted strings. Hot consumers bind actual object/capability references once.
Sprite frames, model replacements and collider-source mutations update retained
geometry bindings at their owning mutation boundary, not by rediscovery each
frame.

Sprite/text/tile/model consumers resolve poses outside their inner geometry loops
and use retained coefficients there; subsequent clean reads perform no
composition. This does not require a second grouping/cache layer for visuals
that already share an owner. Collider caches respond separately to basis and
position changes. Translation-only roots preserve their fast datapath. Pose
invalidation does not rebuild component views or invalidate draw ordering.

Keep existing retained Space/system views, revision-driven render ordering,
constructor specialization and timeline lowering. A method is not assumed free
because it has one line or because the caller was compiled with O3. Generated
runtime syntax and ahead-of-time compilation have different optimization paths;
measure both at the actual hot callsites.

### Evidence required before implementation is accepted

Use dedicated gameplay fixtures, not mutable shipped carts, to prove:

- Default identity placement without authored transform records in both 2D/3D.
- Object-owned local values, zero-scale rotation retention and signed scale.
- Nested full-affine placement, reflection and shear under nonuniform parents,
  including exact Keep World and singular child geometry.
- Current synchronous reads between structural/tick groups.
- Defined reparent failure/removal behavior with no partial state changes.
- One real physical pose shared by movement, overlap and rendering.
- Presentation animation that does not accidentally move collision geometry.
- Staged construction, reentrant lifecycle callbacks and definition replacement.
- Clean-frame zero spatial allocations, translation-only work, dirty-chain work,
  rotation/scale work and actual constructor/teardown cost.
- Emitted instructions/calls and measured cycles on both compilation paths.

Benchmarks must include deep and wide hierarchies, flat moving objects, multiple
consumers, repeated writes before a read and interleaved writes/reads. Report
absolute cost and the baseline; source shape, typechecking and unit-test success
are not performance evidence.

## Production references and chosen differences

- Godot [Node2D](https://github.com/godotengine/godot/blob/master/scene/2d/node_2d.cpp)
  and [Node3D](https://github.com/godotengine/godot/blob/master/scene/3d/node_3d.cpp)
  demonstrate intrinsic spatial objects and reconciliation of editing channels
  with authoritative transforms. Cartlib retains that ownership, not Godot's
  epsilon scale repair or singular-rotation recovery.
- Unity [Transform](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Transform/ScriptBindings/Transform.bindings.cs)
  demonstrates a coherent alternative: a real mandatory Transform component.
  Cartlib does not mix that model with object forwarding facades.
- UE [attachment rules](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/EAttachmentRule)
  establish explicit Keep Relative/Keep World placement vocabulary. Cartlib's
  full-affine result is not a claim of Unreal FTransform numerical parity.
- Bevy [GlobalTransform](https://github.com/bevyengine/bevy/blob/main/crates/bevy_transform/src/components/global_transform.rs)
  demonstrates retained affine world geometry. Its TRS-local reparenting caveats
  do not constrain cartlib's full-affine local authority.
- Filament [TransformManager](https://github.com/google/filament/blob/main/filament/src/components/TransformManager.cpp)
  provides retained topology and dirty-evaluation precedents. C++ storage,
  threading and inline proxies are not automatic performance wins in BLua.
